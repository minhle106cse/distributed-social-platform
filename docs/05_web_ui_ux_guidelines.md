# 🎨 TIÊU CHUẨN UI/UX (WEB UI/UX GUIDELINES)

> 📖 **[English Version](./en/05_web_ui_ux_guidelines.md)**

Tài liệu định nghĩa tiêu chuẩn thiết kế giao diện và trải nghiệm cho **Cortex** — một **search-first knowledge workspace** chạy trên trình duyệt, phong cách Premium (light + dark mode).

---

## 1. Công nghệ Frontend (Web Tech Stack)

- **Framework:** **Vite + React 18** (SPA). Port: `5173`.
- **Routing:** **React Router v7**.
- **State Management:**
  - **Zustand** — Global UI state (theme, sidebar, command palette).
  - **TanStack Query** — Server state, data fetching/caching, optimistic updates.
- **Styling:** **TailwindCSS v3** + **CSS Variables** (design tokens).
- **Markdown/Editor:** rich text + code blocks cho knowledge item; diff view cho revision.
- **Realtime:** WebSocket client cho notification & AI chat streaming.
- **Animation:** **Framer Motion** — micro-animations, skeleton loaders.

---

## 2. Triết lý Trải nghiệm: SEARCH-FIRST

Khác app dashboard truyền thống, Cortex đặt **ô search/hỏi AI** làm trung tâm — vì hành vi #1 của người dùng là **đi tìm tri thức**.

- **Command Palette (`Cmd/Ctrl + K`)**: search xuyên suốt mọi nơi — gõ là tìm, không cần điều hướng.
- **Hai chế độ trong cùng ô:**
  - **Search** → trả về danh sách kết quả (Hybrid: keyword + semantic).
  - **Ask AI** → trả về câu trả lời tổng hợp (RAG) **kèm citation**.
- **Citation rõ ràng:** mỗi câu trả lời AI hiển thị nguồn (card document) để click kiểm chứng → xây niềm tin, chống hallucination.

---

## 3. Bố cục Màn hình chính (Layout)

```
┌──────────────────────────────────────────────────────────────┐
│  [Org ▾]   🔍  Search or Ask AI…              [Credits: 320] 🔔 │  Top bar
├────────────┬─────────────────────────────────────────────────┤
│ Spaces     │   RESULTS / ANSWER                               │
│  • Eng     │   ┌───────────────────────────────────────────┐ │
│  • Product │   │ 🤖 AI Answer (RAG)                        │ │
│  • HR      │   │ "Để rotate JWT secret khi deploy, bạn…"  │ │
│            │   │  Sources: [Deploy Guide] [ADR-12] ←cite  │ │
│ Filters    │   ├───────────────────────────────────────────┤ │
│  Type ▾    │   │ 📄 Deploy Guide · Eng · ✅Verified        │ │
│  Tags ▾    │   │ 📄 ADR-12 Secret Mgmt · Eng              │ │
│  Verified  │   │ ❓ How to rotate secrets · 3 answers      │ │
│            │   └───────────────────────────────────────────┘ │
└────────────┴─────────────────────────────────────────────────┘
```

---

## 4. Các Màn hình Cốt lõi

| Màn hình | Thành phần chính |
|---------|------------------|
| **Home / Search** | Ô search-first, kết quả Hybrid, AI answer + citations |
| **Knowledge Detail** | Nội dung, badge `Verified`/`Stale`, vote, lịch sử revision, "Related" (semantic) |
| **Editor (Wiki)** | Rich editor, autosave draft, **conflict banner** khi OCC 409, diff viewer |
| **Question Detail** | Câu hỏi + answers, accept, bounty (stake credit), thảo luận |
| **AI Assistant Chat** | Hội thoại nhiều lượt, streaming, citation từng câu, "Insufficient credit" state |
| **Credit Wallet** | Balance, lịch sử giao dịch (từ Read Model), mua credit pack |
| **Org Admin** | Thành viên & role, spaces, quota/seat, AI usage analytics |
| **Profile / Reputation** | Điểm, badges, đóng góp, leaderboard |

---

## 5. Trạng thái Hệ thống (System States) — bắt buộc thiết kế

UI phải phản ánh đúng các trạng thái phân tán phía sau:

| Trạng thái | UI |
|-----------|----|
| **AI đang xử lý** | Skeleton + streaming token; nút hủy |
| **AI không khả dụng** (Circuit OPEN) | Banner "AI tạm nghỉ — đang hiển thị kết quả keyword", credit **không bị trừ** |
| **Hết credit** | Modal "Org hết credit", CTA nạp (chỉ Owner) |
| **Rate limited (429)** | Toast "Bạn hỏi quá nhanh, thử lại sau Ns" |
| **OCC conflict (409)** | Banner đỏ + diff "Người khác vừa sửa, hãy merge" |
| **Đang re-index/embed** | Chip "Indexing…" trên doc vừa tạo (semantic search có độ trễ) |
| **Empty org** | Onboarding: "Thêm tài liệu đầu tiên / kết nối nguồn" |

---

## 6. Nguyên tắc Tin cậy & Minh bạch (Trust UX)

1. **Citation luôn hiển thị** với câu trả lời AI — không có nguồn thì cảnh báo.
2. **Verified badge** ✅ phân biệt nội dung đã kiểm chứng vs cộng đồng.
3. **Stale warning** ⚠️ trên tài liệu lỗi thời.
4. **Tenant rõ ràng:** luôn hiển thị org hiện tại; không bao giờ lẫn dữ liệu giữa org.
5. **Credit minh bạch:** hiển thị chi phí ước tính trước khi hỏi AI tốn nhiều credit.

---

## 7. Accessibility & Responsive
- Keyboard-first (command palette, điều hướng kết quả bằng phím).
- WCAG AA contrast cho cả light/dark.
- Responsive: desktop (3 cột) → tablet (2 cột) → mobile (drawer).
