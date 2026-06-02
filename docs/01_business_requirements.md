# 💼 BUSINESS REQUIREMENTS (YÊU CẦU NGHIỆP VỤ)

Tài liệu này định nghĩa "Phần Hồn" của **GrowthGarden V2 (Aesthetic Social Game)**. 

Khẳng định cốt lõi: **Đây không phải là ứng dụng quản lý công việc tự kỷ. Chữa lành mà chơi một mình thì vô vị.** Ứng dụng này sinh ra để người dùng và hội bạn thân cùng nhau ghi nhận nhật ký cảm xúc hằng ngày (Daily Emotion Journaling), gắn kết thông qua một hệ sinh thái nông trại mang đậm tính thẩm mỹ (Aesthetic) và không hề gượng ép (Non-cringe).

Hệ thống được chia thành 3 Trụ Cột (Pillars) sắc bén:

---

# 🏛️ TRỤ CỘT 1: KINH TẾ NÔNG TRẠI (Farming & Aesthetic Economy)

Vòng lặp kinh tế là mồi nhử tạo ra sự "Nghiện" lành mạnh. Người dùng điểm danh cảm xúc không phải vì sợ bị phạt, mà vì khao khát có một khu vườn đẹp độc nhất vô nhị.

## 1.1. Pháo đài Tiền tệ Kép (Karma & Bụi Sao)
- Hệ thống phân định rạch ròi 2 loại tiền tệ để đập tan lỗ hổng "cày clone rửa đồ".
- **Karma (Tiền mềm):** Nhận được hằng ngày qua việc Điểm danh cảm xúc. Chỉ dùng để hỗ trợ như: làm mới (refresh) Thương nhân thần bí, rã đông/khởi động lại chuỗi, hoặc bảo lãnh cứu giúp bạn bè.
- **Bụi Sao (Tiền cứng):** Nhận được rất hạn chế (rớt ra khi đạt các mốc chuỗi lớn như 7, 21, 66 ngày, rớt từ Rương Co-op, hoặc quà AI NPC). Đây là điều kiện BẮT BUỘC để mua trực tiếp vật phẩm trong Shop Thương nhân hoặc nâng cấp vật phẩm lên phẩm chất cao hơn theo tỷ lệ nhất định.
- **Gieo mầm Cảm xúc & Thu hoạch:** Hành trình tâm lý của người dùng được đại diện bởi một mầm cây đồ họa Indie/Cozy. Mỗi ngày người dùng **Điểm danh bằng cách chọn Cảm xúc (A-F) kèm Note** -> Cây lập tức nhận EXP và rớt ra phần thưởng nhỏ là Karma. Điểm danh càng đều, chuỗi (Streak) càng cao thì lượng Karma nhận được mỗi ngày càng lớn. Khi đạt các mốc chuỗi quan trọng (7, 21, 66 ngày), cây hóa Cổ thụ và rớt ra **Bụi Sao**. Người dùng có thể chuyển Cổ Thụ vào Nhà Kính Kỷ Niệm.

## 1.2. Thương Nhân Thần Bí (Gacha & Tiêu thụ Tiền tệ)
- Có Karma rồi làm gì? Dùng Karma để **Refresh (làm mới)** cửa hàng của NPC **Thương nhân Thần bí**.
- Để MUA vật phẩm trong Shop Thương nhân, bắt buộc phải dùng **Bụi Sao**.
- Thương nhân có khả năng bán/rớt ra các mặt hàng: Rương Gacha, Vật phẩm trang trí lẻ, hoặc **Key (Cực kỳ hiếm)**. (Đặc biệt: Rương Gacha khi mở ra có thể rớt tất cả các loại: Karma, Bụi sao, Vật phẩm trang trí, hoặc Key).
- *Lưu ý:* Tuyệt đối không bán đồ bằng tiền thật (No Pay-to-Win).
- **Seed-based RNG (Chống Hack & Xóa Latency):** Tính năng Gacha bắt buộc Online. Tuy nhiên, để UX mượt mà không bị khựng (Latency), Server sẽ cấp trước một mã băm ngẫu nhiên ẩn (Cryptographic Seed) cho Client khi mở Cửa hàng. Khi bấm "Mở rương", Client dùng Seed này để chạy Animation lấp lánh ngay lập tức. Dưới nền, Client đẩy Seed lên Server xác thực. Nếu phát hiện hack DevTools đổi kết quả, Server sẽ từ chối giao dịch dựa trên Seed gốc.

## 1.3. Lò Rèn Thẩm Mỹ (Merging) - Vũ khí Chống Lạm Phát
- **Vấn đề lạm phát:** Nếu người chơi liên tục mở rương, đồ đạc Common sẽ tràn ngập, Karma bị mất giá trị.
- **Giải pháp - Nâng cấp & Đúc (Crafting/Merging):** Đồ đạc dư thừa không được phép đem bán lại (vì game cấm Trading giữa người chơi để chống Smurf). Thay vào đó, người chơi sử dụng tính năng Đúc: Đốt 5 vật phẩm Common + 1 lượng lớn Karma/Stardust để có tỷ lệ rèn ra 1 vật phẩm Epic.
- Đây là một **Hố đen tiêu thụ tiền tệ (Currency Sink)** tuyệt vời, vừa giải quyết lượng đồ rác, vừa tạo ra mục tiêu tối thượng cho người cày cuốc. (Lưu ý: Giống như Gacha, tính năng Đúc là **Online-Only**).

## 1.4. Legendary Gate & Key (Mở Khóa Vùng Đất Mới)
- Khi người chơi thu thập đủ số lượng **Key** (Chìa khóa) từ Thương nhân thần bí hoặc Rương Gacha, họ có thể dùng Key để mở khóa một Vùng Không Gian mới cho Khu vườn (Ví dụ: Nhà Kính Tuyết, Vườn Trên Mây). Phải cần **vài Key** mới mở được một vùng đất để tránh việc phá vỡ end-game nhờ may mắn.
- **Hệ thống Bảo hiểm rủi ro (Pity System) & Mảnh Vỡ Key:** Để tránh nút thắt cổ chai tiến trình do RNG gây ức chế, mỗi khi người chơi mở Rương Gacha hoặc Refresh Shop mà KHÔNG ra Key, họ sẽ nhận được 1 **"Mảnh vỡ Không gian" (Key Fragment)**. Khi tích lũy đủ 100 Mảnh vỡ, người chơi có thể dùng Lò rèn để đúc thành 1 Key hoàn chỉnh. Cơ chế này đảm bảo mọi nỗ lực đều được đền đáp công bằng.

---

# 🏛️ TRỤ CỘT 2: TƯƠNG TÁC XÃ HỘI (The Social Lifeline)

Chúng ta loại bỏ hoàn toàn News Feed cuộn dọc. Mạng xã hội ở đây là một sự **tương tác không gian**. Nếu không có bạn bè, game sẽ chỉ bộc lộ 30% giá trị. Đây là nơi tạo ra sự ràng buộc và động lực sâu sắc nhất.

## 2.1. Khu Phố Thẩm Mỹ (The Neighborhood)
- **Tự động quy tụ:** Khi những người bạn kết nối với nhau, không gian của họ sẽ tự động ghép nối lại thành một **Khu Phố (Neighborhood)**. Không có bang hội đông đúc phức tạp, chỉ là một góc nhỏ cho bạn và những người thân thiết.
- **Chỉ số Vibe & Không gian chung:** Khu phố sở hữu một **Chỉ số Thẩm mỹ chung (Neighborhood Vibes)** - tổng hòa từ điểm cá nhân của từng khu vườn. Chỉ số này sẽ mở khóa các hiệu ứng thời tiết chung tuyệt đẹp cho cả khu phố (Mưa sao băng, Cực quang, Đom đóm). Một người bỏ bê vườn tược có thể kéo lùi vẻ đẹp chung, tạo ra áp lực trách nhiệm nhẹ nhàng.

## 2.2. Hỗ Trợ Đa Dạng & Bảo Lãnh (Empathetic Help & Bailout)
- **Tưới hộ cứu bạn:** Cây sẽ héo úa nếu lười biếng. Bạn bè dạo quanh Khu phố có thể dùng "Nước" của mình để "tưới hộ", giúp cây thoát khỏi bờ vực cái chết. Sự nhắc nhở tinh tế này mạnh hơn mọi Noti khô khan.
- **Cứu rỗi Streak (Bảo lãnh Karma):** Tình bạn đích thực là khi bạn sẵn sàng trả nợ thay bạn mình. Nếu một người lỡ phá giới và vỡ Streak, nhưng không đủ tiền Karma để thanh lọc, bạn bè có thể trích Karma của mình ra để **Bảo lãnh** và khôi phục Streak cho người đó.
- **AI NPC Hỗ trợ Tâm lý:** Hệ thống có AI đóng vai NPC (vd: Cáo lang thang, Cú mèo) thỉnh thoảng ghé thăm vườn khi bạn đi dạo nhà hàng xóm, hoặc xuất hiện khi bạn phục hồi từ Ngủ đông. NPC tặng quà ngẫu nhiên (Karma, Bụi sao). Việc RNG này kích hoạt cho user *active*, chặn triệt để hành vi "Fake Churn" (cố tình nghỉ game để lừa AI phát quà níu kéo).
- **Tặng quà Cảm xúc:** Hỗ trợ nhau bằng việc tặng các vật phẩm trang trí nhỏ (Chuông gió, Hạc giấy, Thiệp viết tay) để động viên tinh thần.

## 2.3. Sự Kiện Khu Phố & Bảng Xếp Hạng Tinh Tế (Co-op & Leaderboard)
- **Công Trình Khu Phố (Neighborhood Monument):** Ở trung tâm mỗi Khu phố có một công trình chung (Đài phun nước, Tháp đồng hồ...). Việc điểm danh cảm xúc mỗi ngày của các thành viên sẽ đóng góp "Năng lượng" vào công trình này. Khi công trình được sạc đầy, nó sẽ kích hoạt và thả xuống "Rương Co-op" (chứa vật phẩm Gacha siêu hiếm).
- **Chống Ký Sinh (Contribution Threshold):** Để ngăn chặn việc một người không đóng góp gì nhưng vẫn nhận Rương Co-op khi đồng đội cày kéo, hệ thống ép buộc một mức đóng góp tối thiểu. Cụ thể: Chỉ những thành viên có mức năng lượng đóng góp > 0 (hoặc vượt ngưỡng X%) trong chu kỳ hiện tại mới đủ điều kiện mở Rương Co-op.
- **Leaderboard Tinh tế:** Game áp dụng hệ thống Bảng xếp hạng giữa các Khu Phố với nhau. Tuy nhiên, nó không xếp hạng dựa trên sự "cày cuốc bạt mạng", mà xếp hạng dựa trên "Độ kiên trì nhóm" và "Chỉ số Thẩm mỹ (Vibes)". Khu phố nào kiên cường nhất và decor đẹp nhất sẽ được vinh danh bằng Cúp Tinh Tú.

## 2.4. Mạng lưới Xã hội & Luật Cư Trú (Topology & Neighborhood Rules)
Để tránh rắc rối về sự chồng chéo các mối quan hệ (Ví dụ: A, B, C ở chung khu phố. D kết bạn với A thì D có vào khu phố không? Nếu A hủy kết bạn D thì sao?), hệ thống phân định rạch ròi giữa **Bạn bè (1-1)** và **Hàng xóm (Nhóm)**:

- **Bạn Bè (1-1):** Kết bạn thông qua quét mã QR hoặc Link mời. Bạn bè có thể thăm vườn của nhau và tưới hộ, nhưng không tự động bị ép vào chung một Khu phố.
- **Luật Định Cư & Mời Gọi (Neighborhood Invites):** Để vào chung một không gian, người chơi phải gửi "Thư mời định cư". Ngoài ra, người chơi có thể Tìm kiếm (Search) và nộp "Đơn xin lưu trú" vào các Khu phố đang công khai tuyển thành viên.
- **Hiệu ứng Bắc Cầu (Hàng xóm):** Khi A mời D vào Khu phố chung (đang có A, B, C), D nghiễm nhiên trở thành **Hàng xóm** của B và C. Hàng xóm có đặc quyền tương tác (tưới hộ, góp năng lượng công trình chung) mà không cần thiết lập kết bạn 1-1.
- **Trải nghiệm Rời đi sòng phẳng (Sunk Cost Exit):** Việc đuổi (Evict) một thành viên là **đặc quyền của Thị trưởng (Chủ khu phố)**. Thị trưởng có toàn quyền quyết định việc giữ hay mời một thành viên rời khỏi Khu phố. ĐẶC BIỆT: Khi một người rời đi (tự nguyện hoặc bị đuổi), họ sẽ **mất trắng** toàn bộ công sức đóng góp cho Công Trình Chung. Không hoàn trả tài nguyên, không trừ điểm công trình. Cơ chế này khóa chặt hành vi bào tài nguyên và giải phóng Backend NestJS khỏi các luồng compensating transactions phức tạp.
- **Khu phố ma & Phế truất tự động (Auto-Transfer):** Một Khu phố giới hạn tối đa **8-10 người** (đảm bảo tính Cozy). Nếu Thị trưởng không đăng nhập liên tục quá 14 ngày, hệ thống sẽ tự động giáng chức Thị trưởng xuống làm thành viên thường và chuyển giao quyền lực. Thuật toán chọn Tân Thị trưởng ưu tiên theo thứ tự: (1) Phó Thị trưởng (nếu có), (2) Người có tổng mức năng lượng đóng góp (Contribution) cho Công trình chung cao nhất, (3) Người có thời gian online gần nhất. Nếu toàn bộ xóm đóng băng, người còn active duy nhất có quyền "Đơn phương ly khai" để tìm Khu phố mới mà không cần chờ duyệt.

---

# 🏛️ TRỤ CỘT 3: Ý CHÍ & SỰ KIÊN CƯỜNG (Non-Cringe Resilience)

Chúng ta loại bỏ hoàn toàn các ngôn từ "gượng ép, trẻ con". Đối tượng là GenZ và người trưởng thành cần sự tinh tế.

## 3.1. Nhật Ký Cảm Xúc (Emotion Check-in) & Khôi Phục Chuỗi
- **Core Mechanic - Emotion Check-in:** Trò chơi loại bỏ hoàn toàn khái niệm "Task/Thói quen". Mỗi ngày, người dùng chỉ cần vào app, thực hiện hành động duy nhất: **Điểm danh bằng cách ghi lại Cảm xúc (A - F) kèm theo Ghi chú (Note)**. Đây là hành động bắt buộc để giữ Chuỗi (Streak). Ghi chú là tùy chọn để chống người dùng gõ bừa ép lấy thưởng.
- **Lưu ý về Phần thưởng & Mốc Điểm Danh Thực Tế:** Mỗi ngày điểm danh chỉ rớt một lượng Karma nhỏ. Chuỗi càng cao, lượng Karma hằng ngày càng lớn (có Cap trần). Để giải quyết triệt để lỗ hổng lách chuỗi bằng cách ngủ đông, các Mốc Chuỗi (7, 21, 66 ngày) để nhận Bụi Sao được tính bằng **Số ngày điểm danh thực tế (Active Check-ins)** thay vì ngày lịch. Những ngày ngủ đông sẽ không được cộng dồn vào tiến trình này.
- **Storage Isolation & Chống Phình Data (Text Bloat):** Việc Note là Tùy chọn xóa bỏ động cơ "gõ bừa". Về mặt hệ thống, luồng lưu Note văn bản bị cách ly hoàn toàn khỏi Core DB. API Gateway nhận text -> đẩy vào Message Queue (Kafka/SQS) -> Worker insert dần vào một NoSQL Database (hoặc Partitioned Table riêng). Schema Core không bao giờ bị nghẽn I/O hay vướng bận Schema Drift khi lưu hàng chục triệu dòng text.
- **Đóng băng & Cooldown Rã đông:** Khi mất chuỗi, hệ thống cho phép dùng Karma rã đông trong vòng 3 ngày (chi phí bị áp Cap trần). ĐẶC BIỆT: Sau khi rã đông, Cây Vệ Thần rơi vào trạng thái "Dưỡng thương" (Hibernation Cooldown). Nếu người dùng tiếp tục bỏ điểm danh trong 3 ngày tiếp theo, cây sẽ chết lập tức và chuỗi bị Reset về 0 mà không được phép dùng Karma cứu nữa. Điều này ngăn chặn vòng lặp "điểm danh 1 ngày, nghỉ 3 ngày".

## 3.2. Trải nghiệm Chữa lành Không Gián đoạn (Offline-First)
- Đang điểm danh mà bị báo "Mất mạng" thì cảm xúc sẽ bị tuột dốc ngay lập tức. Tính năng Offline-First chỉ áp dụng rạch ròi cho **Trụ cột 1 & 2** (Điểm danh cảm xúc, Tương tác xã hội).
- **Optimistic UI & OCC (Chống Race Condition):** Bấm điểm danh -> Cây lấp lánh nhận EXP tức thì. Dữ liệu đẩy vào Hàng đợi Cục bộ (IndexedDB) qua Service Workers. Khi có mạng, Background Sync đồng bộ ngầm. ĐỂ TRÁNH XUNG ĐỘT (VD: bạn bè vừa cứu cây trong lúc bạn offline), hệ thống dùng Optimistic Concurrency Control (OCC) với trường `@Version`. Nếu Server phát hiện Version Client bị cũ, nó từ chối ghi đè, trả về State mới nhất, và hoàn lại Karma (nếu có) vào Pending Stash.

## 3.3. Túi Karma Tạm (Pending Stash) & Ngủ Đông
- **Pending Stash:** Để chống farm rác, Karma nhận hằng ngày bị giới hạn (Global Daily Cap). Nếu Offline xong có mạng lại, đồng bộ ngầm mà bị vượt hạn mức, hệ thống TUYỆT ĐỐI không báo "Lỗi" hay trừ ngược tiền. Phần Karma dư sẽ vào **Pending Stash**, hiển thị pop-up dễ thương: *"Túi tiền đã đầy, số Karma dư sẽ được dùng để tưới mát thảm cỏ chung của khu phố"*.
- **Ngủ đông (Hibernation) & Phục hồi có kiểm soát:** Cho phép user mất chuỗi tối đa 3 ngày trước khi Cây bị đóng băng và mọc cỏ dại. Để rã đông, chỉ cần dùng Karma để phục hồi (chi phí tăng theo chuỗi nhưng có áp Cap trần). Một bước đệm tâm lý hoàn hảo kéo user quay lại mà không gây áp lực. Trong quá trình rã đông, AI NPC có thể ngẫu nhiên xuất hiện tặng quà khích lệ.
