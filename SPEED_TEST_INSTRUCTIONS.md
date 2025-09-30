# AI Provider Speed Test Instructions

Since the console script can't access `chrome.storage.sync`, here's the easiest way to test:

## Method 1: Use the Extension Directly (Recommended)

1. **Go to a short YouTube video** (under 5 minutes is best)
2. **Open your extension popup** (click the extension icon)
3. **Change the AI provider** in settings dropdown
4. **Click "Summarize"** and time how long it takes
5. **Repeat for each provider** you want to test

Write down the times:
- OpenRouter (model: ______): ____ seconds
- Gemini: ____ seconds
- OpenAI: ____ seconds
- Claude: ____ seconds

The fastest one wins! ⏱️

## Method 2: Manual Console Test (Advanced)

If you still want to use the console, try this simpler version:

```javascript
// Paste this in Console on a YouTube video page
(async function() {
  const testTranscript = "This is a test video about web development. It covers HTML, CSS, and JavaScript basics.";

  console.log('🧪 Testing OpenRouter...');
  const start = Date.now();

  const response = await chrome.runtime.sendMessage({
    type: 'summarizeVideo',
    provider: 'openrouter',
    transcript: testTranscript,
    durationSeconds: 60,
    summaryMode: 'bullets'
  });

  const duration = Date.now() - start;
  console.log(`✅ Done in ${duration}ms`);
  console.log('Summary:', response.summary);
})();
```

Change `provider: 'openrouter'` to `'gemini'`, `'openai'`, or `'claude'` to test different providers.

## Common Fast Free Models on OpenRouter:

- `google/gemini-2.0-flash-exp:free` - Usually fastest
- `meta-llama/llama-3.2-3b-instruct:free` - Very fast
- `qwen/qwen-2-7b-instruct:free` - Good balance
- `microsoft/phi-3-mini-128k-instruct:free` - Fast & reliable

You can change your OpenRouter model in the extension settings.