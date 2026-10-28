-- 讓 Mac 畫面上的 Xcode 把小柯麻將裝到接著的 iPhone 並執行
-- （從 SSH 直接簽章會遇到鑰匙圈鎖住；Xcode 在使用者的登入工作階段裡跑，可以用鑰匙圈簽章）
-- 用法：osascript ios/run-on-iphone.applescript /完整路徑/XiaokeMahjong.xcodeproj
on run argv
	set proj to item 1 of argv
	tell application "Xcode"
		activate
		open proj
		set ws to missing value
		repeat 120 times
			try
				set ws to (first workspace document whose path contains "XiaokeMahjong")
				if loaded of ws then exit repeat
			end try
			delay 1
		end repeat
		set active scheme of ws to scheme "XiaokeMahjong" of ws
		set dest to missing value
		repeat 60 times
			try
				set dest to (first run destination of ws whose platform is "iphoneos" and name does not contain "Any")
				exit repeat
			end try
			delay 1
		end repeat
		if dest is missing value then error "找不到接著的 iPhone"
		set active run destination of ws to dest
		set r to run ws
		return "running on " & (name of dest)
	end tell
end run
