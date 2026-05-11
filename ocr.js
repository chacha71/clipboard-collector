const Tesseract = require('tesseract.js');

// ── 清理 OCR 文本中的多余空格 ────────────────────
function cleanOcrText(text) {
  if (!text) return '';
  return text
    // 移除中文字符前后的空格（中文之间不应该有空格）
    .replace(/([一-鿿])\s+([一-鿿])/g, '$1$2')
    // 移除中文和标点之间的空格
    .replace(/([一-鿿])\s+([，。、；：？！])/g, '$1$2')
    .replace(/([，。、；：？！])\s+([一-鿿])/g, '$1$2')
    // 多个空格合并为一个
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── OCR 识别 ────────────────────────────────────
async function recognizeImage(imagePath) {
  try {
    const { data } = await Tesseract.recognize(imagePath, 'chi_sim+eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          // 可以通过 IPC 发送进度
        }
      }
    });

    return {
      text: cleanOcrText(data.text),
      confidence: data.confidence,
      words: data.words
    };
  } catch (err) {
    console.error('OCR 识别失败:', err.message);
    return { text: '', confidence: 0, words: [] };
  }
}

module.exports = { recognizeImage };
