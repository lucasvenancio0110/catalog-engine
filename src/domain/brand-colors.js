const HEX_COLOR = /^#[a-f0-9]{6}$/i;

export function normalizeBrandColor(value) {
  const color = String(value || '').trim();
  return HEX_COLOR.test(color) ? color.toUpperCase() : null;
}

function channelToLinear(channel) {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

export function brandColorLuminance(value) {
  const color = normalizeBrandColor(value);
  if (!color) return null;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return (
    0.2126 * channelToLinear(red) +
    0.7152 * channelToLinear(green) +
    0.0722 * channelToLinear(blue)
  );
}

export function brandContrastRatio(left, right) {
  const leftLuminance = brandColorLuminance(left);
  const rightLuminance = brandColorLuminance(right);
  if (leftLuminance == null || rightLuminance == null) return null;
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function accessibleTextColor(background) {
  const color = normalizeBrandColor(background);
  if (!color) return null;
  const onBlack = brandContrastRatio(color, '#000000');
  const onWhite = brandContrastRatio(color, '#FFFFFF');
  return onBlack >= onWhite ? '#000000' : '#FFFFFF';
}
