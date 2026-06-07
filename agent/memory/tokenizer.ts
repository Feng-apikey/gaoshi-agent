// Bigram tokenizer for Chinese + word splits for English
export function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[，。！？、；：""''（）\n\r]+/g, " ");
  const chars = [...cleaned];
  const tokens: string[] = [];

  for (let i = 0; i < chars.length - 1; i++) {
    const pair = chars[i] + chars[i + 1];
    if (pair.trim().length >= 2 && !/^\s+$/.test(pair)) tokens.push(pair);
  }

  for (const ch of chars) {
    if (/[一-鿿]/.test(ch)) tokens.push(ch);
  }

  for (const word of cleaned.split(/\s+/)) {
    if (word.length >= 2 && /[a-z0-9]/.test(word)) tokens.push(word);
  }

  return [...new Set(tokens)];
}
