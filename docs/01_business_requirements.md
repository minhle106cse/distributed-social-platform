# 💼 BUSINESS REQUIREMENTS (YÊU CẦU NGHIỆP VỤ & TÂM LÝ HỌC NGƯỜI DÙNG)

Tài liệu này định nghĩa "Phần Hồn" của **Distributed Social Productivity Platform - Phiên bản "GrowthGarden V2" (Cozy & Healing)**. 
Ứng dụng từ bỏ các mô hình ép buộc, trừng phạt hoặc mạng xã hội khoe khoang để hướng tới một trải nghiệm **"Chữa lành, Thẩm mỹ (Aesthetic) và Gắn bó Cảm xúc (Emotional Attachment)"**.

Lấy cảm hứng từ các tựa game Cozy (Animal Crossing, Tamagotchi), ứng dụng biến việc phát triển bản thân thành một hành trình chăm sóc một khu vườn nhỏ, nơi sự thấu cảm (Empathy) là chìa khóa giữ chân người dùng.

Hệ sinh thái được chia thành 3 Trụ Cột (Pillars) chính:

---

# 🏛️ TRỤ CỘT 1: TAMAGOTCHI HABITS (Sự gắn bó cảm xúc cá nhân)

Thay vì dọa nạt người dùng bằng việc trừ điểm hay mất chuỗi (Streak), chúng ta sử dụng "Sự thương xót" để tạo động lực.

## 1.1. Sinh linh Thói quen (Habit Pets/Plants)
- **Cơ chế:** Mỗi thói quen (VD: Học Tiếng Anh) là một mầm cây có linh hồn. **Giới hạn Vùng Đất (Zone Limits):** Để tối ưu UI/UX và tránh quá tải không gian, mỗi Khu vườn chỉ chứa tối đa 3-5 thói quen. Muốn trồng thêm, người dùng phải dùng Karma để mở khóa Khu vườn mới.
- **Sự thấu cảm & Loss Aversion:** 
  - Nếu người dùng quên làm task, họ không bị "Shadowban" hay reset Streak. Thay vào đó, mầm cây sẽ đổi trạng thái sang **Héo úa (Sad/Wilted)** kèm theo biểu cảm ủ rũ.
  - Người dùng không mở app vì sợ bị phạt, họ mở app vì *không muốn thấy cái cây bé nhỏ của mình buồn*.
  - Hành động hoàn thành task = **Tưới nước / Vuốt ve**. Cây sẽ vui vẻ, lấp lánh trở lại và dần lớn lên.

## 1.2. Nhật ký Thời tiết (Emotion Weather)
- Không chỉ là log cảm xúc khô khan, tâm trạng của người dùng quyết định **Thời tiết** của toàn bộ khu vườn ngày hôm đó (Nắng đẹp, Cầu vồng, Mưa phùn, Sương mù).
- **Phần thưởng của nỗi buồn (Tránh vòng lặp trầm cảm):** Thay vì làm cây mọc chậm lại (trừng phạt tâm lý), nếu trời mưa liên tục, cơn mưa sẽ tự động "tưới nước" cho cây (không cần làm task cây vẫn không héo). Nỗi buồn còn có tỷ lệ sinh ra "Nấm phát sáng" (vật phẩm hiếm). Sự an ủi này giúp người dùng nhận ra nỗi buồn của họ cũng tạo ra giá trị.

## 1.3. Onboarding & Hiệu ứng Thỏa mãn tức thì (Instant Gratification)
- **Cơ chế 3 ngày đầu:** Để người dùng không bị nản khi chờ cây lớn, trong 3 ngày đầu tiên, mọi tương tác đều tạo ra kết quả ngay lập tức (VD: Tưới nước lần đầu cây nảy mầm và nở hoa ngay lập tức).
- **Phần thưởng khởi đầu:** Tặng ngay một "Hạt giống hiếm" hoặc "Phông nền thời tiết" khi hoàn thành chuỗi 3 ngày đầu. Điều này tạo ra động lực mạnh mẽ để họ gắn bó qua giai đoạn Onboarding - khoảng thời gian dễ bỏ cuộc nhất.

## 1.4. Trạng thái Ngủ đông (Hibernation vs Permadeath)
- Nếu người dùng bỏ app quá 7 ngày, khu vườn bước vào **Trạng thái Ngủ đông (Overgrown Garden):** Cỏ dại mọc um tùm, dây leo bao phủ, tiến trình phát triển bị đóng băng (không chết vĩnh viễn để tránh gây áp lực tội lỗi).
- **Dọn dẹp mùa xuân (Decoupled Spring Cleaning):** Khi quay lại, thay vì bắt người dùng thực hiện toàn bộ 5 thói quen cùng lúc (gây áp lực quá tải), họ chỉ cần chọn ra 1 **Thói quen Cốt lõi (Keystone Habit)**. Chỉ cần duy trì thói quen duy nhất này trong 3 ngày liên tiếp, toàn bộ băng giá và cỏ dại sẽ bị phá vỡ, khu vườn được rã đông. Bước đệm tâm lý này giúp họ lấy lại động lực một cách nhẹ nhàng.

## 1.5. Cơ chế Ân xá (Grace Period & Hồi tố)
- **Vấn đề:** Người dùng đã làm thói quen ngoài đời thực nhưng mệt quá ngủ quên, không mở app log. Sáng hôm sau thấy cây héo sẽ sinh ra sự phẫn nộ và bất công.
- **Giải pháp - Grace Period (UI Ngái ngủ & Múi giờ):** Cung cấp "Quyền Hồi tố" đến 10h sáng hôm sau. Backend quản lý bằng múi giờ gốc (Primary Timezone) do user thiết lập để chống hack đổi giờ. Từ 00:00 đến 10:00, UI ở trạng thái "Ngái ngủ" (Pending) để chờ user. 
  - *Đánh thức Cây (Early Bird):* Trạng thái Ngái ngủ chỉ là hiển thị. Nếu user dậy sớm (ví dụ 5:30 sáng) và làm task, cây lập tức thức giấc và nhận kinh nghiệm bình thường, không cản trở người có kỷ luật.
  - *Dịch chuyển Múi giờ (Relocation):* Không theo dõi GPS ngầm (không yêu cầu quyền Web Geolocation API). Thay vào đó, khi người dùng chủ động truy cập Web App và check-in, hệ thống sẽ so sánh Timestamp của Trình duyệt (Browser) và Server. Nếu lệch quá 2 tiếng trong 3 lần check-in liên tiếp, hệ thống mới hiển thị pop-up gợi ý cập nhật Primary Timezone (Giới hạn đổi tối đa 2 lần/năm).
- **Giới hạn Bình tưới Thời gian (Hard Cap):** Thỉnh thoảng Cụ Rùa bán "Bình tưới quay ngược thời gian". Để chống lạm dụng, vật phẩm này là Unique: Túi đồ chỉ chứa tối đa 1 bình, và chỉ bán 2 lần/tháng.

## 1.6. Thói quen Từ bỏ (Quitting Habits & Guardian Plants)
- **Vấn đề:** Nhiều người dùng tìm đến ứng dụng để "cai" thói quen xấu (ngừng thức khuya, bỏ trà sữa). Việc ép luồng "từ bỏ" vào cơ chế "tưới nước cho cây lớn" là khiên cưỡng và sai logic.
- **Giải pháp - Cây Vệ Thần (Guardian Plant):** Các thói quen cần từ bỏ sẽ được đại diện bởi các Sinh vật / Cây Vệ thần.
  - *Vòng đời Task đảo ngược:* Hệ thống không ghi nhận thành tựu ngay khi bấm nút. User chỉ nhận điểm khi kết thúc ngày (00:00) mà KHÔNG có báo cáo vi phạm. Lúc đó, cây sẽ tự sinh ra "Khiên năng lượng" hoặc nở hoa.
  - *Trạng thái Trúng độc:* Nếu lỡ phá giới (uống trà sữa), cây không héo úa (để tránh tạo áp lực tiêu cực kép), mà rơi vào trạng thái "Trúng độc". User phải dùng điểm Karma để mua thuốc giải cứu cây. Thiết kế này biến sự trừng phạt thành sự bảo vệ.

## 1.7. Trải nghiệm Chữa lành Không Gián đoạn (Offline-First)
- **Vấn đề:** Người dùng đang trên tàu điện ngầm hoặc vùng sóng yếu, muốn check-in thói quen nhưng nhận được thông báo "Lỗi kết nối mạng". Cảm xúc "chữa lành" sẽ bị phá vỡ ngay lập tức.
- **Giải pháp - Optimistic UI:** Giao diện ứng dụng phải phản hồi lập tức. Ngay khi bấm "Hoàn thành", cây lập tức lấp lánh và nhận EXP (Optimistic Update). Ở dưới ngầm, hệ thống đẩy thao tác này vào Hàng đợi Cục bộ (Local Queue) và tự động đồng bộ (Background Sync) với Backend khi có mạng trở lại, đảm bảo sự mượt mà tuyệt đối.

---

# 🏛️ TRỤ CỘT 2: BẢN ĐỒ KHU PHỐ (The Cozy Social Island)

Loại bỏ hoàn toàn Feed "Tin tức" cuộn dọc (nhàm chán và dễ gây áp lực đồng trang lứa). Mạng xã hội giờ đây là một sự tương tác không gian.

## 2.1. Thăm Vườn (Garden Hopping) & Tưới Hộ (Empathetic Help)
- **Cơ chế:** Người dùng không "đăng bài". Khu vườn của họ chính là profile của họ. Người dùng khác có thể "ghé thăm" vườn của bạn bè.
- **Tương tác chữa lành (Chống Lạm dụng & Free-rider):**
  - Nếu A ốm không vào app, cây héo. B ghé thăm có thể dùng Nước của mình để **Tưới hộ**.
  - **Giới hạn Cân bằng:** Nước tưới hộ chỉ giúp cây của A *cầm cự* (không héo thêm), nhưng KHÔNG làm cây lớn lên. Chỉ có "Nước chính chủ" mới kích hoạt sự phát triển. Mỗi người dùng chỉ được tưới hộ tối đa 3 lần/ngày để tránh tình trạng nhóm bạn "cày Karma chéo" bỏ quên thói quen thật.

## 2.2. Cây Thần Đồng Đội (Co-op World Tree)
- Thay vì các nhóm "Thi đua" căng thẳng, một nhóm bạn có thể cùng nhau trồng chung một Cây Thần ở trung tâm khu phố.
- **Đóng góp cân bằng (Fair-play):** Tránh tình trạng 1 người gánh 90% nước. Cây Thần có các nhánh rẽ khác nhau. Nhánh của ai người nấy tưới, cây chỉ tiến hóa (upgrade form) khi TẤT CẢ các nhánh đều đạt mốc yêu cầu.
- **Xử lý Dead Branch (Khối tạ):** Nếu một thành viên bỏ app quá 7 ngày, khu vườn của họ rơi vào Ngủ đông. Nhánh cây của họ trên Cây Thần sẽ hóa thành "Nhánh Tinh Linh" (Ghost Branch) - trong suốt. Hệ thống TẠM THỜI LOẠI TRỪ nhánh này khỏi điều kiện tiến hóa của Cây Thần để những người còn lại vẫn có thể lên cấp.
- **Chống Thao túng (Catch-up Lock):** Để chống việc 3 người cố tình nghỉ để "báo" 2 người gánh, sau đó quay lại nhận thưởng: Khi Nhánh Tinh Linh tái kết nối với một Cây Thần ĐÃ tiến hóa, người dùng đó sẽ bị **Khóa phần thưởng**. Họ buộc phải thực hiện chuỗi "Tưới nước bù" (ví dụ: làm task 5 ngày liên tục) để nhánh của họ bắt kịp hình thái mới của Cây Thần thì mới được nhận thưởng.

## 2.3. Mạng lưới Xã hội Khép kín (Private Social Graph)
- **Không tìm kiếm tự do:** Để bảo vệ sự an toàn cảm xúc và tránh quấy rối, ứng dụng KHÔNG có tính năng tìm kiếm user công khai.
- **Kết nối chọn lọc:** User chỉ có thể làm bạn qua 2 hình thức:
  - *Invite-only:* Quét mã QR hoặc gửi link Invite cho những người bạn thân thiết thực sự ở ngoài đời.
  - *Anonymous Match-making:* Hệ thống tự động ghép cặp ẩn danh những user có chung mục tiêu thói quen (VD: Cùng trồng Guardian Plant "Bỏ hút thuốc"). Điều này giúp tạo ra một cộng đồng chất lượng, thấu cảm và có cùng mức độ cam kết với bản thân.

---

# 🏛️ TRỤ CỘT 3: VÒNG LẶP KINH TẾ (Marketplace of Aesthetics)

Sử dụng sức mạnh của Gamification và Kiến trúc phân tán (Event-Driven) để tạo ra sự "Nghiện" lành mạnh.

## 3.1. Karma & Cửa hàng Thẩm mỹ (Aesthetic Shop)
- **Tích luỹ Karma:** Nhận được khi duy trì thói quen, hoặc làm việc tốt (Đi tưới cây hộ bạn bè).
  - *Kiểm soát Vĩ mô (Global Daily Cap):* Để chống lạm phát kinh tế do user tạo nhiều thói quen "rác" để farm Karma, hệ thống thiết lập mức trần tối đa Karma kiếm được mỗi ngày. Khi đạt giới hạn, user vẫn check-in được để duy trì sự sống cho cây, nhưng không nhận thêm tiền tệ. Van an toàn này giữ cho vật phẩm Legendary luôn có giá trị.
  - *Vết kiểm toán Không thể Sửa đổi (Immutable Ledger):* Để quản trị viên thực sự kiểm soát được dòng chảy tiền tệ (Cash flow) và lạm phát, mọi giao dịch sinh/tiêu Karma BẮT BUỘC phải được ghi vào một Sổ Cái (Ledger) chỉ cho phép thêm mới (Append-only). Điều này cung cấp Data-driven cho việc vận hành.
- **Tiêu Karma:** Thay vì thuê người làm task (quá nghiêm túc), người dùng dùng Karma để mua sắm đồ trang trí: Chậu cây hiếm, Mũ cho cây, Phông nền Mưa Sao Băng...
- **Tâm lý học:** Giới trẻ thích cái Đẹp (Aesthetics). Khả năng custom hóa (trang trí) khu vườn độc bản của riêng mình chính là động lực lớn nhất để họ cày Karma mỗi ngày.

## 3.2. Cấp độ Vật phẩm (Rarity Levels) & Healing Gacha (Hạt giống kỳ bí)
- **Cấp độ Vật phẩm:** Để kích thích sự khao khát sưu tầm (Collection), các chậu cây, phông nền, phụ kiện được chia thành 4 cấp bậc: 
  - 🟢 **Common (Thường):** Dễ kiếm, mua trực tiếp bằng Karma.
  - 🔵 **Rare (Hiếm):** Thiết kế đẹp hơn, có hiệu ứng nhẹ, mua bằng Karma hoặc quay trúng.
  - 🟣 **Epic (Sử thi):** Hiệu ứng thời tiết/lấp lánh cực đẹp, chỉ có được nhờ sự chăm chỉ tích luỹ hoặc quay trúng.
  - 🟡 **Legendary (Huyền thoại):** Thay đổi hoàn toàn không gian vườn, siêu hiếm. Đòi hỏi nỗ lực cực lớn hoặc "nhân phẩm" cao.
- **Cơ chế Healing Gacha (Hạt giống kỳ bí):** 
  - Tuyệt đối không dùng tiền thật. NPC *Cụ Rùa Bán Dạo* thỉnh thoảng sẽ ghé thăm khu vườn và bán "Hạt giống kỳ bí" bằng Karma. Khi gieo hạt, sau một thời gian sẽ nảy mầm ra vật phẩm ngẫu nhiên theo tỷ lệ cấp độ (Rarity) bên trên.
  - **Pity System (Lòng bao dung):** Không bao giờ có sự xui xẻo vĩnh viễn. Nếu mở liên tục 9 hạt giống Common, hạt thứ 10 CHẮC CHẮN là Rare trở lên. 
  - **Tái chế & Kinh tế Mùa giải (Seasons):** Đồ trùng lặp được quy đổi thành "Bụi Lấp Lánh" (Stardust) để đổi thẳng vật phẩm Epic/Legendary. Tuy nhiên, để **chống lạm phát (Stardust Inflation)** và cạn kiệt nội dung End-game, hệ thống áp dụng cơ chế Mùa giải. Stardust của Mùa Xuân chỉ đổi được đồ Mùa Xuân. Sang Mùa Hè, BST mới xuất hiện yêu cầu loại Stardust mới, giữ cho nền kinh tế luôn cân bằng và có mục tiêu mới.
  - **Chống Smurf & Chợ Đen (Account-Bound):** Để ngăn chặn việc tạo tài khoản ảo cày Karma lấy đồ Legendary rồi tuồn về tài khoản chính, TOÀN BỘ vật phẩm Gacha đều là **Soulbound (Khóa chặt vào tài khoản)**. Ứng dụng CẤM HOÀN TOÀN tính năng Giao dịch (Trading) vật phẩm giữa người chơi. Tương tác kinh tế duy nhất giữa người chơi là Tip Karma cho nhau khi tưới hộ.

## 3.3. AI Người Làm Vườn (The Empathetic Gardener)
- AI không bao giờ bóc phốt. AI đóng vai trò như một NPC (Nhân vật ảo) dễ thương trong game.
- **Giới hạn quyền năng (Chống Exploit):** Dựa trên RAG (đọc lịch sử cảm xúc), AI sẽ để lại những bức thư tay nhỏ: *"Dạo này khu vườn hay sương mù, chắc bạn đang stress lắm. Gửi tặng bạn chút Bụi Lấp Lánh động viên nhé."*
- AI **TUYỆT ĐỐI KHÔNG** can thiệp vào Logic trạng thái cốt lõi (không đóng băng hay khóa trạng thái héo úa của cây). Điều này tránh việc người dùng nhận ra mô hình và cố tình khai báo "buồn" liên tục để AI dung túng cho sự trì hoãn (Procrastination). Background Worker của AI chỉ có quyền Read lịch sử, gửi Message và tặng Stardust lượng nhỏ.

## 3.4. Mô hình Sinh tồn (Monetization & Freemium)
Sự chữa lành không tự chi trả được chi phí vận hành khổng lồ của LLM, Kafka và Database. Ứng dụng cần một mô hình sinh tồn thực tế nhưng không được vi phạm triết lý cốt lõi.
- **Nguyên tắc cốt lõi:** Không Pay-to-Win. Khóa hoàn toàn đồ Gacha và Karma khỏi các giao dịch tiền thật để bảo vệ tính nguyên bản của trải nghiệm và giá trị của sự nỗ lực.
- **Gói Đăng ký (Premium Subscription):** Bán "Sự tiện lợi" và "Không gian mở rộng":
  - *Mở rộng không gian:* User miễn phí có 1 khu vườn (giới hạn số cây). User Premium được mở khóa "Nhà kính tuyết" hoặc "Vườn trên mây" để theo dõi nhiều thói quen hơn.
  - *Deep AI Insights:* User Premium được cấp quyền truy cập vào các bản báo cáo phân tích tâm lý chuyên sâu định kỳ từ AI Gardener, dựa trên lưu trữ log cảm xúc dài hạn.
