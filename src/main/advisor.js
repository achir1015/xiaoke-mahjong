'use strict';
// AI 軍師：呼叫 Claude（Anthropic SDK，串流回覆）
const AnthropicMod = require('@anthropic-ai/sdk');
const Anthropic = AnthropicMod.default || AnthropicMod;

const SYSTEM = [
  '你是「小柯軍師」，一位親切又專業的台灣 16 張麻將教練，在牌局進行中替使用者出主意。',
  '一律使用台灣繁體中文，口吻像坐在旁邊小聲指點的老師，可以自然夾帶台灣牌桌口語（例如：聽、到、放銃、自摸、現物、金三銀七）。',
  '規則：144 張（萬筒條各 36、字牌 28、花 8），每人 16 張、莊家 17 張開門；胡牌＝5 組面子（順子或刻子）加 1 對眼。可以吃（只能吃上家）、碰、槓（明槓、暗槓、加槓），優先順序 胡 > 碰槓 > 吃，同時多人胡由最近的下家截胡；留 16 張不摸，摸完流局。放棄胡牌後到自己下一次摸牌前不能胡（過水）。',
  '計分：每家付「底＋台數×每台」，自摸三家付、放槍一家付；莊家相關的那一筆多 1 台，連莊每次再加 2 台（連一拉一）。',
  '每則使用者訊息都附有最新的【牌局資訊】：自己的手牌、吃碰槓、花牌、各家牌河與明牌、剩餘張數，以及本機 AI 引擎算出的候選打法（向聽數、有效進張、聽哪些牌與剩幾張、放槍風險）。',
  '本機引擎的數字是可靠的計算結果，請以它為主要依據，再用白話說明理由（速度、牌效、台數、防守）。不要自行編造不存在的牌。',
  '回答要精簡：先用一句話給結論（建議打哪一張，或要不要吃碰），再用 2～4 個重點說明。',
  '使用者是牌局資訊裡標示「您」的那一家，只替這一家出主意。',
  '如果使用者聊的不是牌局，可以簡短友善地回應，再自然地拉回牌局。',
].join('\n');

const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

class Advisor {
  constructor({ getKey, getSettings }) {
    this.getKey = getKey;
    this.getSettings = getSettings;
    this.active = new Map(); // id → stream
  }

  client() {
    const apiKey = this.getKey();
    if (!apiKey) return null;
    return new Anthropic({ apiKey, maxRetries: 2, timeout: 120000 });
  }

  params(messages, maxTokens, effort) {
    const s = this.getSettings();
    const model = s.model || 'claude-opus-5-5';
    const p = {
      model,
      max_tokens: maxTokens,
      system: SYSTEM,
      messages,
      output_config: { effort: effort || s.effort || 'low' },
    };
    // 安全分類器拒答時，由伺服器自動改用建議的備援模型重跑
    if (FALLBACK_MODELS.has(model)) {
      p.betas = ['server-side-fallback-2026-07-01'];
      p.fallbacks = 'default';
    }
    return p;
  }

  explain(err) {
    if (err instanceof Anthropic.AuthenticationError) return 'API 金鑰無效，請到「設定」重新輸入 Anthropic API 金鑰。';
    if (err instanceof Anthropic.PermissionDeniedError) return '這把金鑰沒有使用此模型的權限，請到「設定」換一個模型或金鑰。';
    if (err instanceof Anthropic.NotFoundError) return '找不到指定的模型，請到「設定」改用 claude-opus-5-5。';
    if (err instanceof Anthropic.RateLimitError) return '請求太頻繁或額度用完了，請稍後再問。';
    if (err instanceof Anthropic.BadRequestError) return '請求格式有誤：' + (err.message || '');
    if (err instanceof Anthropic.APIConnectionError) return '連不上 Claude 伺服器，請檢查網路。';
    if (err instanceof Anthropic.APIError) return `Claude 回應錯誤（${err.status || ''}）：${err.message || ''}`;
    return String((err && err.message) || err);
  }

  // payload: { messages:[{role, content}], effort? }
  async ask(sender, id, payload) {
    const send = (ch, data) => { if (!sender.isDestroyed()) sender.send(ch, { id, ...data }); };
    const client = this.client();
    if (!client) { send('advisor:done', { error: 'nokey' }); return; }
    let stream;
    try {
      stream = client.beta.messages.stream(this.params(payload.messages, 4000, payload.effort));
      this.active.set(id, stream);
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') send('advisor:delta', { text: ev.delta.text });
      }
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') {
        send('advisor:done', { error: '軍師這題無法回答，換個問法試試看。' });
        return;
      }
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      send('advisor:done', { text, model: msg.model, truncated: msg.stop_reason === 'max_tokens' });
    } catch (err) {
      if (stream && stream.aborted) { send('advisor:done', { error: 'cancelled' }); return; }
      send('advisor:done', { error: this.explain(err) });
    } finally {
      this.active.delete(id);
    }
  }

  cancel(id) {
    const s = this.active.get(id);
    if (s) { try { s.abort(); } catch {} this.active.delete(id); }
  }

  cancelAll() { for (const id of [...this.active.keys()]) this.cancel(id); }

  // 測試金鑰
  async test() {
    const client = this.client();
    if (!client) return { ok: false, error: '尚未設定 API 金鑰' };
    try {
      const p = this.params([{ role: 'user', content: '請用一句話向牌友打招呼。' }], 2000, 'low');
      const msg = await client.beta.messages.create(p);
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return { ok: true, text, model: msg.model };
    } catch (err) {
      return { ok: false, error: this.explain(err) };
    }
  }
}

module.exports = { Advisor };
