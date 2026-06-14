# 🎨 TIÊU CHUẨN UI/UX (WEB UI/UX GUIDELINES)

> 📖 **[English Version](./en/05_web_ui_ux_guidelines.md)**

Tài liệu định nghĩa tiêu chuẩn thiết kế giao diện và trải nghiệm cho **TeamFin** — một Dashboard Finance App chạy trên trình duyệt với phong cách Premium Dark Mode.

---

## 1. Công nghệ Frontend (Web Tech Stack)

- **Framework:** **Vite + React 18** (SPA — Single Page Application). Port: `5173`.
- **Routing:** **React Router v7**.
- **State Management:**
  - **Zustand** — Global UI state (theme, sidebar, modal).
  - **TanStack Query (React Query)** — Server state, data fetching/caching, optimistic updates.
- **Styling:**
  - **TailwindCSS v3** — Utility classes.
  - **CSS Variables** — Design tokens (colors, spacing, radii).
- **Charts:** **Recharts** — Spending analytics, monthly trends, category breakdown.
- **Animation:** **Framer Motion** — Micro-animations, page transitions, skeleton loaders.
- **Forms:** **React Hook Form + Zod** — Form validation with TypeScript inference.
- **HTTP Client:** **Axios** — Interceptors cho auto-refresh token, idempotency key injection.
- **Date:** **dayjs** — Date formatting, relative time.
- **Notifications:** **react-hot-toast** — In-app toast notifications.
- **Icons:** **Lucide React** — Consistent icon set.

---

## 2. Kiến trúc UI (Dashboard Application)

### 2.1. Layout Structure

```
┌────────────────────────────────────────────────────────────┐
│ TOPBAR (Fixed)                                             │
│ ┌──────┐  TeamFin    [Group Selector ▼]  🔔  👤 Avatar ▼ │
│ └──────┘                                                   │
├────────────┬───────────────────────────────────────────────┤
│ SIDEBAR    │ MAIN CONTENT                                  │
│ (Fixed)    │                                               │
│            │  ┌────────────────────────────────────────┐   │
│ 📊 Dashboard│  │  Page Header                          │   │
│ 💰 Expenses │  │  ──────────────────────────────────── │   │
│ 🤝 Settle  │  │  Content Area                          │   │
│ 👥 Members │  │                                        │   │
│ 📈 Analytics│  │  (Cards, Tables, Charts, Forms)       │   │
│ ⚙️ Settings │  │                                        │   │
│            │  └────────────────────────────────────────┘   │
│            │                                               │
└────────────┴───────────────────────────────────────────────┘
```

### 2.2. Core Pages

| Page | Route | Mô tả |
|------|-------|-------|
| **Dashboard** | `/groups/:id` | Tổng quan: Balance summary, recent expenses, quick actions |
| **Expenses** | `/groups/:id/expenses` | Danh sách expenses, search, filter by category/date |
| **Add Expense** | `/groups/:id/expenses/new` | Form tạo expense (multi-payer, split method) |
| **Expense Detail** | `/groups/:id/expenses/:eid` | Chi tiết expense, activity log, edit |
| **Settle Up** | `/groups/:id/settle` | Flow thanh toán nợ, debt simplification suggestions |
| **Members** | `/groups/:id/members` | Danh sách thành viên, roles, invite link |
| **Analytics** | `/groups/:id/analytics` | Charts: by category, monthly trend, top spender |
| **Groups** | `/groups` | Danh sách tất cả nhóm của user |
| **Create Group** | `/groups/new` | Form tạo nhóm mới |
| **Settings** | `/settings` | User profile, preferences, notifications |
| **Login/Register** | `/auth/login`, `/auth/register` | Authentication |

### 2.3. Responsive Breakpoints

| Breakpoint | Width | Layout |
|-----------|-------|--------|
| Mobile | < 768px | Sidebar collapse → Bottom Tab Bar. Single column. |
| Tablet | 768–1024px | Sidebar mini (icons only). 2-column grid. |
| Desktop | > 1024px | Full sidebar. 3-column grid. |

---

## 3. Trạng thái UI (UI State Handling)

### 3.1. Balance Display

| Balance | Color | Icon | Mô tả |
|---------|-------|------|-------|
| Positive (được nợ) | `--color-positive` green | ↗️ | "Bạn được nợ 500k" |
| Negative (nợ) | `--color-negative` red | ↙️ | "Bạn nợ 300k" |
| Zero (settled) | `--color-muted` gray | ✓ | "Đã settle xong" |

### 3.2. Expense States

| State | Badge Color | Mô tả |
|-------|------------|-------|
| Active | — (no badge) | Chi phí đang hoạt động |
| Updated | `--color-warning` amber | Có sửa đổi (version > 1) |
| Deleted | `--color-negative` red | Đã xóa (soft delete) |

### 3.3. Loading States

- **Skeleton Loader:** Dùng cho Dashboard cards, Expense list, Balance summary.
- **Spinner:** Dùng cho button actions (Submit, Settle).
- **Optimistic UI:** Tạo expense → UI update ngay, revert nếu server reject.

### 3.4. Empty States

| Page | Empty Message | CTA |
|------|--------------|-----|
| Groups | "Chưa có nhóm nào" | "Tạo nhóm đầu tiên" |
| Expenses | "Chưa có chi phí nào" | "Thêm chi phí đầu tiên" |
| Members | "Chưa có ai ngoài bạn" | "Mời bạn bè" |

---

## 4. File Structure

```
apps/web/src/
├── components/
│   ├── layout/
│   │   ├── Topbar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── MainLayout.tsx
│   │   └── MobileTabBar.tsx
│   ├── common/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   ├── Badge.tsx
│   │   ├── Avatar.tsx
│   │   ├── CurrencyDisplay.tsx
│   │   ├── BalanceIndicator.tsx
│   │   └── SkeletonLoader.tsx
│   ├── expense/
│   │   ├── ExpenseForm.tsx
│   │   ├── ExpenseCard.tsx
│   │   ├── ExpenseList.tsx
│   │   ├── SplitMethodPicker.tsx
│   │   └── CategoryBadge.tsx
│   ├── settlement/
│   │   ├── SettleUpFlow.tsx
│   │   ├── DebtSimplification.tsx
│   │   └── SettlementCard.tsx
│   ├── group/
│   │   ├── GroupCard.tsx
│   │   ├── GroupForm.tsx
│   │   ├── MemberList.tsx
│   │   └── InviteLink.tsx
│   └── charts/
│       ├── SpendingByCategory.tsx
│       ├── MonthlyTrend.tsx
│       └── BalanceOverview.tsx
├── pages/
│   ├── DashboardPage.tsx
│   ├── ExpensesPage.tsx
│   ├── AddExpensePage.tsx
│   ├── SettlePage.tsx
│   ├── MembersPage.tsx
│   ├── AnalyticsPage.tsx
│   ├── GroupsPage.tsx
│   ├── CreateGroupPage.tsx
│   ├── LoginPage.tsx
│   └── RegisterPage.tsx
├── hooks/
│   ├── useExpenses.ts          # TanStack Query hooks
│   ├── useBalances.ts
│   ├── useGroups.ts
│   ├── useSettlements.ts
│   └── useWebSocket.ts         # Real-time subscription
├── stores/
│   └── ui.store.ts              # Zustand: theme, sidebar, activeGroup
├── services/
│   ├── api.ts                   # Axios instance + interceptors
│   └── websocket.ts             # WebSocket client
├── types/
│   └── index.ts                 # TypeScript definitions
└── styles/
    └── index.css                # Global styles + design tokens
```

---

## 5. Quyền Riêng Tư (Privacy-First UX)

- Không yêu cầu quyền Location.
- Mời vào nhóm chỉ qua Link/QR — không tìm kiếm người lạ.
- Financial data không hiển thị cho role `VIEWER` ngoài tổng hợp.
- Export PDF chỉ cho Owner/Admin.
