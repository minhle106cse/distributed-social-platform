# 🧩 DESIGN SYSTEM & TOKENS

> 📖 **[English Version](./en/07_design_system_assets.md)**

Design Tokens, Typography Scale, Spacing System, và Component Specs cho **Cortex** — search-first knowledge workspace (light + dark mode).

---

## 1. Color System

### 1.1. Brand & Semantic Colors

| Token | Hex | Dùng cho |
|-------|-----|----------|
| `--color-primary` | `#6366f1` | Primary actions, active states (Indigo 500) |
| `--color-primary-hover` | `#4f46e5` | Hover state |
| `--color-ai` | `#8b5cf6` | AI/RAG surfaces, assistant accent (Violet 500) |
| `--color-success` | `#22c55e` | Verified, success states (Green 500) |
| `--color-danger` | `#ef4444` | Error, conflict (Red 500) |
| `--color-warning` | `#f59e0b` | Stale, quota alerts (Amber 500) |
| `--color-info` | `#3b82f6` | Links, hints (Blue 500) |

### 1.2. Semantic State Colors (Knowledge)

| Token | Hex | Ý nghĩa |
|-------|-----|---------|
| `--state-verified` | `#22c55e` | Nội dung đã kiểm chứng ✅ |
| `--state-stale` | `#f59e0b` | Tài liệu lỗi thời ⚠️ |
| `--state-draft` | `#94a3b8` | Bản nháp |
| `--state-ai` | `#8b5cf6` | Câu trả lời AI |
| `--state-credit` | `#eab308` | Credit / token economy |

### 1.3. Surface (Light / Dark)

| Token | Light | Dark |
|-------|-------|------|
| `--bg-base` | `#ffffff` | `#0b0f1a` |
| `--bg-elevated` | `#f8fafc` | `#131826` |
| `--border` | `#e2e8f0` | `#1e293b` |
| `--text-primary` | `#0f172a` | `#e2e8f0` |
| `--text-muted` | `#64748b` | `#94a3b8` |

---

## 2. Typography

| Token | Size / Line | Dùng cho |
|-------|-------------|----------|
| `--font-display` | 32/40 | Tiêu đề trang |
| `--font-h1` | 24/32 | Tiêu đề knowledge item |
| `--font-h2` | 20/28 | Section |
| `--font-body` | 16/24 | Nội dung |
| `--font-sm` | 14/20 | Meta, captions |
| `--font-mono` | 14/22 | Code block, citation id |

- **Font:** Inter (UI) + JetBrains Mono (code/citation).
- **Reading width:** body knowledge tối đa `72ch` để dễ đọc.

---

## 3. Spacing & Radius

- Spacing scale: `4, 8, 12, 16, 24, 32, 48` (`--space-1..7`).
- Radius: `--radius-sm 6px`, `--radius-md 10px`, `--radius-lg 16px`, `--radius-pill 999px`.
- Shadow: `--shadow-card`, `--shadow-popover` (command palette, AI panel).

---

## 4. Component Specs (đặc thù Cortex)

| Component | Spec |
|-----------|------|
| **Command Palette** | `Cmd/Ctrl+K`, 2 tab: Search / Ask AI; kết quả có icon theo `KnowledgeType` |
| **AI Answer Card** | Nền `--color-ai` nhạt, badge "AI", **danh sách citation bắt buộc** ở chân |
| **Citation Chip** | Mono id + title; click mở document nguồn |
| **Verified Badge** | ✅ pill `--state-verified` |
| **Stale Banner** | ⚠️ banner `--state-stale` "Tài liệu này có thể đã lỗi thời" |
| **Conflict Banner** | đỏ, hiện khi OCC 409, kèm nút "Xem diff" |
| **Credit Pill** | hiển thị số dư; đổi màu cảnh báo khi thấp |
| **Vote Control** | up/down, hiển thị score |

---

## 5. Iconography
- Bộ icon: **Lucide**. Mapping: `DOCUMENT`→file-text, `QUESTION`→help-circle, `RUNBOOK`→book-open, `ADR`→git-branch, `AI`→sparkles, `Verified`→badge-check, `Stale`→clock-alert.

---

## 6. Motion
- Streaming AI: token fade-in.
- Skeleton cho search/embedding-pending.
- Reduced-motion: tôn trọng `prefers-reduced-motion`.
