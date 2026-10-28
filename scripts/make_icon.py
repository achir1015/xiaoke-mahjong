# 產生程式圖示：立體「紅中」麻將牌＋小柯機器人
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024


def font(size):
    for f in ('C:/Windows/Fonts/kaiu.ttf', 'C:/Windows/Fonts/msjhbd.ttc', '/System/Library/Fonts/Supplemental/Songti.ttc'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def layer():
    return Image.new('RGBA', (S, S), (0, 0, 0, 0))


img = layer()
# 陰影
sh = layer()
ImageDraw.Draw(sh).rounded_rectangle((150, 170, 700, 930), 70, fill=(0, 0, 0, 150))
img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(28)))

# 麻將牌（略為傾斜）：綠色牌背＋象牙白牌面
tile = layer()
d = ImageDraw.Draw(tile)
d.rounded_rectangle((150, 120, 660, 880), 70, fill=(12, 110, 62, 255))       # 綠色牌背
d.rounded_rectangle((150, 120, 660, 820), 70, fill=(236, 228, 206, 255))     # 牌側
d.rounded_rectangle((132, 96, 640, 790), 66, fill=(250, 246, 234, 255))      # 牌面
d.rounded_rectangle((170, 134, 602, 752), 40, outline=(220, 210, 186, 255), width=6)
d.text((386, 440), '中', font=font(430), fill=(200, 16, 46, 255), anchor='mm', stroke_width=6, stroke_fill=(200, 16, 46, 255))
tile = tile.rotate(8, resample=Image.BICUBIC, center=(400, 500))
img = Image.alpha_composite(img, tile)

# 小柯機器人（頭盔造型）
rb = layer()
r = ImageDraw.Draw(rb)
cx, cy = 720, 650
# 天線
r.line((cx, cy - 250, cx, cy - 190), fill=(90, 100, 120, 255), width=18)
r.ellipse((cx - 34, cy - 290, cx + 34, cy - 222), fill=(255, 196, 40, 255))
# 耳朵
r.rounded_rectangle((cx - 262, cy - 70, cx - 210, cy + 80), 22, fill=(40, 120, 220, 255))
r.rounded_rectangle((cx + 210, cy - 70, cx + 262, cy + 80), 22, fill=(40, 120, 220, 255))
# 頭
r.ellipse((cx - 230, cy - 210, cx + 230, cy + 220), fill=(70, 150, 240, 255))
r.ellipse((cx - 214, cy - 196, cx + 214, cy + 200), fill=(240, 246, 255, 255))
# 面罩
r.rounded_rectangle((cx - 170, cy - 110, cx + 170, cy + 90), 90, fill=(24, 36, 64, 255))
# 眼睛（笑眼）
for ex in (cx - 72, cx + 72):
    r.arc((ex - 46, cy - 50, ex + 46, cy + 30), 200, 340, fill=(90, 230, 255, 255), width=22)
# 嘴
r.arc((cx - 50, cy + 10, cx + 50, cy + 70), 20, 160, fill=(90, 230, 255, 255), width=14)
# 臉頰
r.ellipse((cx - 160, cy + 40, cx - 110, cy + 80), fill=(255, 140, 160, 200))
r.ellipse((cx + 110, cy + 40, cx + 160, cy + 80), fill=(255, 140, 160, 200))
# 揮手的小手拿著一張小牌
r.rounded_rectangle((cx + 150, cy + 150, cx + 270, cy + 300), 22, fill=(12, 110, 62, 255))
r.rounded_rectangle((cx + 146, cy + 146, cx + 262, cy + 286), 22, fill=(250, 246, 234, 255))
r.text((cx + 204, cy + 214), '發', font=font(96), fill=(15, 122, 58, 255), anchor='mm')
sh2 = layer()
ImageDraw.Draw(sh2).ellipse((cx - 230, cy - 180, cx + 250, cy + 260), fill=(0, 0, 0, 120))
img = Image.alpha_composite(img, sh2.filter(ImageFilter.GaussianBlur(24)))
img = Image.alpha_composite(img, rb)

os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
img.save(os.path.join(ROOT, 'build', 'icon.png'))
img.save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print('ok')
