# YouTube AI Video Summarizer Chrome Extension

## Project Overview
A Chrome extension that automatically summarizes YouTube videos by extracting their transcriptions and processing them through various AI providers (Claude, GPT, etc.).

## Features
- **One-click summarization**: Simple button click to generate video summaries
- **Multiple AI providers**: Choose between Claude, GPT, Chrome's built-in AI, and other AI services
- **Transcript extraction**: Automatically pulls YouTube video transcriptions
- **Quick access**: Browser extension for seamless integration

## Technical Stack
- **Frontend**: HTML, CSS, JavaScript (Chrome Extension APIs)
- **APIs**: 
  - YouTube Data API / Transcript extraction
  - OpenAI API (GPT models)
  - Anthropic API (Claude models)
  - Chrome's built-in AI APIs (Prompt API, Summarization API)
  - Other AI provider APIs as needed

## Core Functionality
1. **Video Detection**: Detect when user is on a YouTube video page
2. **Transcript Retrieval**: Extract video transcript/captions
3. **AI Selection**: UI to choose preferred AI provider
4. **Summarization**: Send transcript to selected AI for processing
5. **Display Results**: Show summary in extension popup or overlay

## File Structure
```
/
├── manifest.json          # Extension configuration
├── popup.html             # Extension popup UI
├── popup.js              # Popup functionality
├── content.js            # YouTube page interaction
├── background.js         # Background service worker
├── styles.css            # Extension styling
├── icons/                # Extension icons
└── config.js             # AI API configurations
```

## Development Commands
- Load extension: Chrome → Extensions → Developer mode → Load unpacked
- Test on YouTube videos with available transcripts
- Configure API keys for AI providers

## API Requirements
- YouTube transcript access (youtube-transcript library or similar)
- AI provider API keys (OpenAI, Anthropic, etc.)
- Chrome's built-in AI APIs (no keys required, local processing)
- Proper CORS handling for external API calls

## User Flow
1. Navigate to YouTube video
2. Click extension icon
3. Select AI provider from dropdown
4. Click "Summarize" button
5. View generated summary in popup

## Security Considerations
- Store API keys securely using Chrome storage API
- Validate transcript content before sending to AI
- Handle rate limiting for AI APIs
- Respect YouTube's terms of service