# 🧩 DESIGN SYSTEM & TOKENS

> 📖 **[English Version](./en/07_design_system_assets.md)**

Design Tokens, Typography Scale, Spacing System, và Component Specs cho **TeamFin** — Premium Dark Mode Finance Dashboard.

---

## 1. Color System

### 1.1. Brand & Semantic Colors

| Token | Hex | Dùng cho |
|-------|-----|----------|
| `--color-primary` | `#6366f1` | Primary actions, active states (Indigo 500) |
| `--color-primary-hover` | `#4f46e5` | Hover state |
| `--color-positive` | `#22c55e` | Số dương (được nợ), success states (Green 500) |
| `--color-negative` | `#ef4444` | Số âm (nợ), error states (Red 500) |
| `--color-warning` | `#f59e0b` | Cảnh báo, budget alerts (Amber 500) |
| `--color-info` | `#3b82f6` | Thông tin, links (Blue 500) |

### 1.2. Currency Colors

| Token | Hex | Dùng cho |
|-------|-----|----------|
| `--color-vnd` | `#ef4444` | VND amounts (Red) |
| `--color-usd` | `#22c55e` | USD amounts (Green) |
| `--color-eur` | `#3b82f6` | EUR amounts (Blue) |
| `--color-jpy` | `#f59e0b` | JPY amounts (Amber) |

### 1.3. Category Colors (Charts)

| Category | Hex | Display |
|----------|-----|---------|
| FOOD | `#ef4444` | 🍕 Ăn uống |
| TRANSPORT | `#3b82f6` | 🚗 Di chuyển |
| ACCOMMODATION | `#8b5cf6` | 🏨 Chỗ ở |
| ENTERTAINMENT | `#f59e0b` | 🎬 Giải trí |
| UTILITIES | `#06b6d4` | ⚡ Tiện ích |
| SHOPPING | `#ec4899` | 🛍️ Mua sắm |
| HEALTH | `#22c55e` | 🏥 Sức khỏe |
| EDUCATION | `#6366f1` | 📚 Giáo dục |
| OTHER | `#64748b` | 📦 Khác |

### 1.4. Dark Mode Palette

| Token | Hex | Dùng cho |
|-------|-----|----------|
| `--bg-primary` | `#030712` | Page background (Gray 950) |
| `--bg-secondary` | `#0f172a` | Card background (Slate 900) |
| `--bg-tertiary` | `#1e293b` | Input, hover state (Slate 800) |
| `--border-primary` | `#334155` | Borders, dividers (Slate 700) |
| `--border-secondary` | `#475569` | Active borders (Slate 600) |
| `--text-primary` | `#f8fafc` | Main text (Slate 50) |
| `--text-secondary` | `#94a3b8` | Secondary text (Slate 400) |
| `--text-muted` | `#64748b` | Muted/hint text (Slate 500) |

### 1.5. CSS Variables

```css
:root {
  /* Brand */
  --color-primary: #6366f1;
  --color-primary-hover: #4f46e5;

  /* Semantic */
  --color-positive: #22c55e;
  --color-negative: #ef4444;
  --color-warning: #f59e0b;
  --color-info: #3b82f6;

  /* Dark Mode */
  --bg-primary: #030712;
  --bg-secondary: #0f172a;
  --bg-tertiary: #1e293b;
  --border-primary: #334155;
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;

  /* Glass Effect */
  --glass-bg: rgba(15, 23, 42, 0.8);
  --glass-border: rgba(51, 65, 85, 0.5);
  --glass-blur: 12px;
}
```

---

## 2. Typography Scale

| Token | Font | Weight | Size | Line Height | Dùng cho |
|-------|------|--------|------|-------------|----------|
| `display` | Outfit | 800 | 30px | 1.1 | Page title, hero |
| `h1` | Outfit | 700 | 24px | 1.2 | Section headers |
| `h2` | Outfit | 600 | 20px | 1.3 | Card titles |
| `h3` | Outfit | 600 | 18px | 1.4 | Sub-sections |
| `body` | Inter | 400 | 16px | 1.6 | Body text |
| `body-sm` | Inter | 400 | 14px | 1.5 | Descriptions, list items |
| `caption` | Inter | 400 | 12px | 1.4 | Hints, timestamps |
| `label` | Inter | 500 | 12px | 1.0 | Tags, badges (UPPERCASE) |
| `amount-lg` | JetBrains Mono | 700 | 28px | 1.0 | Balance display |
| `amount-md` | JetBrains Mono | 600 | 18px | 1.0 | Expense amount |
| `amount-sm` | JetBrains Mono | 400 | 14px | 1.0 | Split detail |

### Font Loading

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
```

---

## 3. Spacing System

Bội số **4px** (chuẩn Tailwind):

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| `xs` | 4px | `p-1` | Inline spacing |
| `sm` | 8px | `p-2` | Icon padding |
| `md` | 12px | `p-3` | Button padding |
| `base` | 16px | `p-4` | Card padding |
| `lg` | 24px | `p-6` | Section gap |
| `xl` | 32px | `p-8` | Page margin |
| `2xl` | 48px | `p-12` | Large sections |

---

## 4. Component Tokens

| Component | Border Radius | Padding | Min Height | Notes |
|-----------|---------------|---------|------------|-------|
| Card | 16px | 20px 24px | — | Glass effect, subtle border |
| Modal | 24px | 24px 32px | — | Centered overlay |
| Button (md) | 10px | 10px 20px | 44px | — |
| Button (sm) | 8px | 6px 14px | 36px | — |
| Button (icon) | 10px | 10px | 44px | Square |
| Input | 10px | 12px 14px | 44px | — |
| Select | 10px | 12px 14px | 44px | — |
| Badge | 20px (pill) | 4px 12px | 24px | — |
| Avatar | 50% (circle) | — | 40px | — |
| Sidebar | 0 | 16px | 100vh | Fixed left |
| Topbar | 0 | 0 16px | 64px | Fixed top |

---

## 5. Animation Specs (Framer Motion)

| Animation | Config | Duration | Usage |
|-----------|--------|----------|-------|
| Page transition | `opacity: 0→1, y: 8→0` | 0.2s | Route change |
| Modal appear | `scale: 0.95→1, opacity: 0→1` | 0.2s spring | Modal open |
| Card hover | `y: 0→-2, shadow increase` | 0.15s | Expense card hover |
| Skeleton pulse | `opacity: [0.3, 0.6, 0.3]` | 1.5s repeat | Loading state |
| Toast slide | `x: 100%→0` | 0.3s spring | Notification toast |
| Balance counter | `countUp animation` | 0.5s | Balance number change |
| Chart draw | `pathLength: 0→1` | 0.8s ease-out | Chart line animation |
| List stagger | `y: 10→0, opacity: 0→1` | 0.1s delay between | List items appear |

---

## 6. Currency Formatting Rules

| Currency | Format | Example | Decimals |
|----------|--------|---------|----------|
| VND | `{amount}₫` | `800,000₫` | 0 |
| USD | `${amount}` | `$50.00` | 2 |
| EUR | `€{amount}` | `€42.50` | 2 |
| JPY | `¥{amount}` | `¥5,000` | 0 |
| THB | `฿{amount}` | `฿1,500.00` | 2 |

### Dual Display

Khi expense có tiền tệ khác base currency:
```
Primary:   $50.00
Secondary: ≈ 1,250,000₫
```

### Balance Colors

```
Positive (được nợ): +500,000₫  → color: --color-positive (green)
Negative (nợ):      -300,000₫  → color: --color-negative (red)
Zero (settled):     0₫         → color: --text-muted (gray)
```
