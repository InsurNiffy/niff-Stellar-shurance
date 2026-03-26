# NiffyInsur Brand Guidelines

This document outlines the visual identity and styling standards for NiffyInsur.

## Color Palette

### Primary (Azure Blue)
- **HSL**: `217 91% 60%`
- **Hex**: `#3b82f6`
- **Usage**: Buttons, links, primary brand elements.

### Secondary (Slate)
- **HSL**: `222 47% 11%` (Foreground) / `0 0% 100%` (Background)
- **Usage**: Typography, borders, subtle UI elements.

### Status Colors
- **Success**: `142 71% 45%` (Green)
- **Warning**: `48 96% 53%` (Yellow)
- **Destructive**: `0 84% 60%` (Red)

## Typography

### Headings & Body
- **Font**: [Inter](https://rsms.me/inter/)
- **Weight**: 400 (Regular), 500 (Medium), 600 (Semi-Bold), 700 (Bold)

### Technical & Data
- **Font**: [IBM Plex Mono](https://github.com/IBM/plex)
- **Usage**: Addresses, transaction hashes, smart contract code, numbers.

## UI Principles

1. **Glassmorphism**: Use the `.glass` utility for cards and overlays to create depth.
   - Example: `<div className="glass rounded-lg p-6">...</div>`
2. **Interactive States**:
   - **Hover**: Subtle scaling or opacity shift.
   - **Focus**: Clear Azure Blue ring (`focus-ring` utility).
3. **Dark Mode**: Automatically respects system preferences, manual override available via `ThemeToggle`.

## Assets
- **Logo Mark**: [icon.svg](/frontend/public/icon.svg)
- **Manifest**: [site.webmanifest](/frontend/public/site.webmanifest)
