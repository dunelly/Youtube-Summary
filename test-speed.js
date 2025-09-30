// Speed test for AI providers
// Run this in browser console on a YouTube video page to test which provider is fastest

async function testProviderSpeed() {
  console.log('🧪 Starting AI Provider Speed Test...\n');

  // Test transcript (short sample)
  const testTranscript = `
Welcome to this tutorial. Today we'll be covering three main topics.
First, we'll discuss the basics of web development.
Second, we'll explore modern JavaScript features.
Finally, we'll look at best practices for code organization.
Let's get started with the first topic.
`;

  const testPrompt = `Summarize this transcript in 3 bullet points:\n\n${testTranscript}`;

  // Get settings
  const settings = await chrome.storage.sync.get([
    'geminiKey',
    'openaiKey',
    'claudeKey',
    'openrouterKey',
    'openrouterModel'
  ]);

  const providers = [];

  if (settings.geminiKey) providers.push({ name: 'Gemini Flash', id: 'gemini' });
  if (settings.openaiKey) providers.push({ name: 'OpenAI', id: 'openai' });
  if (settings.claudeKey) providers.push({ name: 'Claude', id: 'claude' });
  if (settings.openrouterKey) providers.push({ name: `OpenRouter (${settings.openrouterModel || 'default'})`, id: 'openrouter' });

  if (providers.length === 0) {
    console.error('❌ No API keys configured! Please add keys in settings.');
    return;
  }

  console.log(`Testing ${providers.length} providers:\n`);

  const results = [];

  // Test each provider
  for (const provider of providers) {
    console.log(`⏱️  Testing ${provider.name}...`);

    const startTime = performance.now();

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'summarizeVideo',
        provider: provider.id,
        transcript: testTranscript,
        durationSeconds: 60,
        summaryMode: 'bullets'
      });

      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);

      if (response.status === 'ok') {
        results.push({
          name: provider.name,
          time: duration,
          success: true,
          preview: response.summary.substring(0, 80) + '...'
        });
        console.log(`   ✅ ${duration}ms`);
      } else {
        results.push({
          name: provider.name,
          time: duration,
          success: false,
          error: response.message
        });
        console.log(`   ❌ Failed: ${response.message}`);
      }
    } catch (error) {
      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);

      results.push({
        name: provider.name,
        time: duration,
        success: false,
        error: error.message
      });
      console.log(`   ❌ Error: ${error.message}`);
    }

    // Wait 1 second between tests to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Sort by speed
  const successful = results.filter(r => r.success).sort((a, b) => a.time - b.time);
  const failed = results.filter(r => !r.success);

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESULTS (Fastest to Slowest)');
  console.log('='.repeat(60) + '\n');

  if (successful.length > 0) {
    successful.forEach((result, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
      console.log(`${medal} ${index + 1}. ${result.name}: ${result.time}ms`);
      console.log(`   Preview: ${result.preview}\n`);
    });

    const fastest = successful[0];
    const slowest = successful[successful.length - 1];
    const speedup = ((slowest.time / fastest.time) * 100 - 100).toFixed(0);

    console.log(`\n🏆 Winner: ${fastest.name} (${fastest.time}ms)`);
    if (successful.length > 1) {
      console.log(`📉 ${fastest.name} is ${speedup}% faster than ${slowest.name}`);
    }
  }

  if (failed.length > 0) {
    console.log('\n❌ Failed providers:');
    failed.forEach(result => {
      console.log(`   - ${result.name}: ${result.error}`);
    });
  }

  console.log('\n' + '='.repeat(60));

  return results;
}

// Run the test
testProviderSpeed();