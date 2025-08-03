// Enhanced Content script for prompt detection and saving with FIXED save functionality
class PromptInjector {
  constructor() {
    this.isEnabled = true;
    this.selectedText = "";
    this.db = null;
    this.dbManager = null;
    this.chromeExtensionContext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;
    this.init();
  }

  async init() {
    try {
      await this.initDB();
      this.addSelectionListener();
      this.addFloatingButton();
      this.detectAIChats();
      console.log('PromptInjector initialized successfully');
    } catch (error) {
      console.error('Failed to initialize PromptInjector:', error);
      // Continue without DB
      this.addSelectionListener();
      this.addFloatingButton();
      this.detectAIChats();
    }
  }

  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('PromptHiveDB', 3);
      
      request.onerror = () => {
        console.error('Database failed to open:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        console.log('Database opened successfully in injector');
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log('Database upgrade needed in injector...');
        
        // Create prompts store if it doesn't exist
        if (!db.objectStoreNames.contains('prompts')) {
          const promptStore = db.createObjectStore('prompts', { keyPath: 'id' });
          promptStore.createIndex('title', 'title', { unique: false });
          promptStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
          promptStore.createIndex('createdAt', 'createdAt', { unique: false });
          promptStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          promptStore.createIndex('uses', 'uses', { unique: false });
          promptStore.createIndex('version', 'version', { unique: false });
          promptStore.createIndex('category', 'category', { unique: false });
        }
        
        // Create prompt history store if it doesn't exist
        if (!db.objectStoreNames.contains('promptHistory')) {
          const historyStore = db.createObjectStore('promptHistory', { keyPath: 'historyId' });
          historyStore.createIndex('promptId', 'promptId', { unique: false });
          historyStore.createIndex('version', 'version', { unique: false });
          historyStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Create analytics store if it doesn't exist
        if (!db.objectStoreNames.contains('analytics')) {
          const analyticsStore = db.createObjectStore('analytics', { keyPath: 'id', autoIncrement: true });
          analyticsStore.createIndex('promptId', 'promptId', { unique: false });
          analyticsStore.createIndex('action', 'action', { unique: false });
          analyticsStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  addSelectionListener() {
    document.addEventListener("mouseup", (e) => {
      if (!this.isEnabled) return;

      const selection = window.getSelection();
      const selectedText = selection.toString().trim();

      if (selectedText.length > 10) {
        this.selectedText = selectedText;
        this.showFloatingButton(e.pageX, e.pageY);
      } else {
        this.hideFloatingButton();
      }
    });

    // Hide floating button when clicking elsewhere
    document.addEventListener("mousedown", (e) => {
      if (!e.target.closest("#prompthive-floating-btn")) {
        this.hideFloatingButton();
      }
    });
  }

  addFloatingButton() {
    // Remove existing button if it exists
    const existingButton = document.getElementById("prompthive-floating-btn");
    if (existingButton) {
      existingButton.remove();
    }

    const button = document.createElement("div");
    button.id = "prompthive-floating-btn";
    button.innerHTML = `
      <div class="prompthive-btn-content">
        <span class="prompthive-icon">🏠</span>
        <span class="prompthive-text">Save to PromptHive</span>
      </div>
    `;
    button.style.display = "none";
    
    // FIXED: Use addEventListener instead of inline onclick
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.saveSelectedText();
    });

    document.body.appendChild(button);
  }

  showFloatingButton(x, y) {
    const button = document.getElementById("prompthive-floating-btn");
    if (!button) return;

    button.style.display = "block";
    button.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    button.style.top = `${Math.max(y - 50, 10)}px`;
  }

  hideFloatingButton() {
    const button = document.getElementById("prompthive-floating-btn");
    if (button) {
      button.style.display = "none";
    }
  }

  async saveSelectedText() {
    console.log('saveSelectedText called with:', this.selectedText.substring(0, 50) + '...');
    
    if (!this.selectedText || this.selectedText.trim().length < 5) {
      this.showErrorNotification('Selected text is too short to save');
      return;
    }

    const cleanText = this.selectedText.trim();
    
    // Create prompt object with enhanced metadata
    const prompt = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      title: this.generateTitle(document.title, cleanText),
      text: cleanText,
      tags: this.generateTags(cleanText, window.location.href),
      date: new Date().toLocaleDateString(),
      uses: 0,
      version: 1,
      category: this.detectCategory(cleanText, window.location.href),
      source: window.location.href,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log('Attempting to save prompt:', prompt.id);

    try {
      // PRIMARY: Save to IndexedDB first (most reliable)
      const dbSaved = await this.savePromptToDB(prompt);
      console.log('IndexedDB save result:', dbSaved);
      
      if (dbSaved) {
        console.log('Prompt saved to IndexedDB successfully:', prompt.id);
        
        // SECONDARY: Try background script (if extension context available)
        if (this.chromeExtensionContext) {
          try {
            const response = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({
                action: "savePrompt",
                prompt: prompt
              }, (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(response);
                }
              });
            });
            
            if (response && response.success) {
              console.log('Prompt also saved via background script');
            }
          } catch (bgError) {
            console.warn('Background script save failed, but IndexedDB save succeeded:', bgError);
          }
        } else {
          console.log('Chrome extension context not available, skipping background save');
        }

        // Log analytics
        await this.logAnalytics(prompt.id, 'context_save', {
          source: 'floating_button',
          url: window.location.href,
          textLength: cleanText.length
        });

        this.showSaveNotification('Prompt saved successfully!');
        
        // Clean up UI
        this.hideFloatingButton();
        window.getSelection().removeAllRanges();
        
      } else {
        throw new Error('Failed to save to IndexedDB');
      }
    } catch (error) {
      console.error('Primary save method failed:', error);
      
      // FALLBACK: Try background script only if extension context is available
      if (this.chromeExtensionContext) {
        try {
          const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              action: "savePrompt",
              prompt: prompt
            }, (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response);
              }
            });
          });
          
          if (response && response.success) {
            console.log('Prompt saved via background script fallback');
            this.showSaveNotification('Prompt saved successfully!');
            // Clean up UI
            this.hideFloatingButton();
            window.getSelection().removeAllRanges();
          } else {
            throw new Error('Background script save failed: ' + (response ? response.error : 'No response'));
          }
        } catch (fallbackError) {
          console.error('Fallback save method also failed:', fallbackError);
          this.showErrorNotification('Failed to save prompt. Please try the extension popup.');
        }
      } else {
        // No extension context available
        console.error('No extension context and IndexedDB failed. Cannot save.');
        this.showErrorNotification('Failed to save prompt. Please try refreshing the page.');
      }
    }
  }

  generateTitle(pageTitle, text) {
    // Create a meaningful title
    const domain = window.location.hostname.replace('www.', '');
    const shortTitle = pageTitle ? pageTitle.substring(0, 40) : domain;
    const shortText = text.substring(0, 30);
    
    return `${shortTitle} - ${shortText}${text.length > 30 ? '...' : ''}`;
  }

  generateTags(text, url) {
    const tags = ['saved', 'context-menu'];
    
    // Add page type tag
    const pageType = this.detectPageType(url);
    if (pageType) tags.push(pageType);
    
    // Add content-based tags
    const textLower = text.toLowerCase();
    if (textLower.includes('code') || textLower.includes('function') || textLower.includes('javascript')) {
      tags.push('coding');
    }
    if (textLower.includes('write') || textLower.includes('content') || textLower.includes('article')) {
      tags.push('writing');
    }
    if (textLower.includes('analyze') || textLower.includes('data') || textLower.includes('research')) {
      tags.push('analysis');
    }
    
    return tags;
  }

  detectCategory(text, url) {
    const textLower = text.toLowerCase();
    const urlLower = url ? url.toLowerCase() : '';
    
    // Programming/coding keywords
    if (this.containsKeywords(textLower, ['code', 'function', 'javascript', 'python', 'react', 'api', 'debug', 'programming', 'algorithm', 'database']) ||
        urlLower.includes('github') || urlLower.includes('stackoverflow')) {
      return 'coding';
    }
    
    // Writing/content keywords
    if (this.containsKeywords(textLower, ['write', 'article', 'blog', 'content', 'essay', 'story', 'copywriting', 'marketing'])) {
      return 'writing';
    }
    
    // Analysis/research keywords
    if (this.containsKeywords(textLower, ['analyze', 'research', 'data', 'study', 'report', 'statistics', 'insights', 'trends'])) {
      return 'analysis';
    }
    
    // Creative keywords
    if (this.containsKeywords(textLower, ['creative', 'design', 'art', 'music', 'brainstorm', 'innovative', 'imagination'])) {
      return 'creative';
    }
    
    return 'general';
  }

  containsKeywords(text, keywords) {
    return keywords.some(keyword => text.includes(keyword));
  }

  async savePromptToDB(prompt) {
    if (!this.db) {
      console.warn('Database not initialized, cannot save to IndexedDB');
      return false;
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(['prompts'], 'readwrite');
        const store = transaction.objectStore('prompts');
        const request = store.put(prompt);
        
        request.onsuccess = () => {
          console.log('Prompt saved to IndexedDB:', prompt.id);
          resolve(true);
        };
        
        request.onerror = () => {
          console.error('Error saving prompt to IndexedDB:', request.error);
          resolve(false); // Changed from reject to resolve(false) for better flow control
        };

        transaction.onerror = () => {
          console.error('Transaction error:', transaction.error);
          resolve(false); // Changed from reject to resolve(false) for better flow control
        };

        transaction.onabort = () => {
          console.error('Transaction aborted');
          resolve(false);
        };
      } catch (error) {
        console.error('Exception in savePromptToDB:', error);
        resolve(false); // Changed from reject to resolve(false) for better flow control
      }
    });
  }

  async logAnalytics(promptId, action, metadata = {}) {
    if (!this.db) {
      console.warn('Database not initialized, skipping analytics');
      return;
    }

    try {
      const transaction = this.db.transaction(['analytics'], 'readwrite');
      const store = transaction.objectStore('analytics');
      
      const analyticsEntry = {
        promptId,
        action,
        metadata,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href
      };
      
      store.add(analyticsEntry);
      console.log('Analytics logged:', action);
    } catch (error) {
      console.warn('Failed to log analytics:', error);
    }
  }

  detectPageType(url) {
    if (!url) return "web";
    
    const hostname = url.toLowerCase();
    
    const pageTypes = {
      "openai.com": "chatgpt",
      "chat.openai": "chatgpt", 
      "claude.ai": "claude",
      "bard.google": "bard",
      "gemini.google": "gemini",
      "perplexity.ai": "perplexity",
      "github.com": "github",
      "stackoverflow.com": "stackoverflow",
      "stackexchange.com": "stackexchange",
      "reddit.com": "reddit",
      "medium.com": "medium",
      "dev.to": "dev",
      "hackernews": "hackernews",
      "twitter.com": "twitter",
      "x.com": "twitter",
      "linkedin.com": "linkedin",
      "youtube.com": "youtube",
      "docs.google.com": "gdocs",
      "notion.so": "notion",
      "obsidian.md": "obsidian"
    };
    
    for (const [domain, type] of Object.entries(pageTypes)) {
      if (hostname.includes(domain)) {
        return type;
      }
    }
    
    return "web";
  }

  detectAIChats() {
    // Enhanced detection for AI chat interfaces
    const hostname = window.location.hostname;
    
    if (hostname.includes("openai.com")) {
      this.enhanceChatGPT();
    } else if (hostname.includes("claude.ai")) {
      this.enhanceClaude();
    } else if (hostname.includes("bard.google") || hostname.includes("gemini.google")) {
      this.enhanceGemini();
    } else if (hostname.includes("perplexity.ai")) {
      this.enhancePerplexity();
    }
  }

  enhanceChatGPT() {
    // Add save buttons to ChatGPT messages
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.addSaveButtonsToChatGPT(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Initial scan
    this.addSaveButtonsToChatGPT(document.body);
  }

  enhanceClaude() {
    // Add save buttons to Claude messages
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.addSaveButtonsToClaude(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Initial scan
    this.addSaveButtonsToClaude(document.body);
  }

  enhanceGemini() {
    // Add save buttons to Gemini messages
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.addSaveButtonsToGemini(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  enhancePerplexity() {
    // Add save buttons to Perplexity messages
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.addSaveButtonsToPerplexity(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  addSaveButtonsToChatGPT(container) {
    // Look for message containers in ChatGPT
    const messages = container.querySelectorAll('[data-message-author-role="assistant"], .markdown, [class*="markdown"]');
    messages.forEach((message) => {
      if (message.querySelector(".prompthive-inline-btn")) return;

      const saveBtn = this.createInlineSaveButton();
      const messageContent = message.querySelector(".prose, .markdown, [class*=\"markdown\"]") || message;
      
      if (messageContent && messageContent.textContent.trim().length > 50) {
        // FIXED: Use addEventListener instead of inline event handler
        saveBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.saveMessageContent(messageContent.textContent, "ChatGPT Response");
        });
        
        // Position the button
        message.style.position = 'relative';
        message.appendChild(saveBtn);
      }
    });
  }

  addSaveButtonsToClaude(container) {
    // Look for message containers in Claude
    const messages = container.querySelectorAll('[data-testid="message"], .font-claude-message, [class*="message"]');
    messages.forEach((message) => {
      if (message.querySelector(".prompthive-inline-btn")) return;

      const saveBtn = this.createInlineSaveButton();
      const messageContent = message.querySelector(".prose, .markdown, [class*=\"markdown\"]") || message;
      
      if (messageContent && messageContent.textContent.trim().length > 50) {
        // FIXED: Use addEventListener instead of inline event handler
        saveBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.saveMessageContent(messageContent.textContent, "Claude Response");
        });
        
        // Position the button
        message.style.position = 'relative';
        message.appendChild(saveBtn);
      }
    });
  }

  addSaveButtonsToGemini(container) {
    // Look for message containers in Gemini
    const messages = container.querySelectorAll('[data-test-id="model-response"], .model-response-text, [class*="response"]');
    messages.forEach((message) => {
      if (message.querySelector(".prompthive-inline-btn")) return;

      const saveBtn = this.createInlineSaveButton();
      
      if (message.textContent.trim().length > 50) {
        // FIXED: Use addEventListener instead of inline event handler
        saveBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.saveMessageContent(message.textContent, "Gemini Response");
        });
        
        // Position the button
        message.style.position = 'relative';
        message.appendChild(saveBtn);
      }
    });
  }

  addSaveButtonsToPerplexity(container) {
    // Look for message containers in Perplexity
    const messages = container.querySelectorAll('.prose, [class*="answer"], [class*="response"]');
    messages.forEach((message) => {
      if (message.querySelector(".prompthive-inline-btn")) return;

      const saveBtn = this.createInlineSaveButton();
      
      if (message.textContent.trim().length > 50) {
        // FIXED: Use addEventListener instead of inline event handler
        saveBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.saveMessageContent(message.textContent, "Perplexity Response");
        });
        
        // Position the button
        message.style.position = 'relative';
        message.appendChild(saveBtn);
      }
    });
  }

  createInlineSaveButton() {
    const button = document.createElement("button");
    button.className = "prompthive-inline-btn";
    button.innerHTML = `
      <span class="prompthive-icon">🏠</span>
      <span>Save</span>
    `;
    return button;
  }

  async saveMessageContent(content, title) {
    const cleanContent = content.trim();
    
    if (cleanContent.length < 10) {
      this.showErrorNotification('Content is too short to save');
      return;
    }

    const prompt = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      title: title,
      text: cleanContent,
      tags: ["ai-response", this.detectPageType(window.location.href)],
      date: new Date().toLocaleDateString(),
      uses: 0,
      version: 1,
      category: this.detectCategory(cleanContent, window.location.href),
      source: window.location.href,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      // Save to IndexedDB first
      const saved = await this.savePromptToDB(prompt);
      if (saved) {
        console.log('AI response saved to IndexedDB successfully:', prompt.id);
        
        // Also try to save via background script if extension context available
        if (this.chromeExtensionContext) {
          try {
            const response = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({
                action: "savePrompt",
                prompt: prompt
              }, (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(response);
                }
              });
            });
            
            if (response && response.success) {
              console.log('AI response also saved via background script');
            }
          } catch (bgError) {
            console.warn('Background script save failed for AI response, but IndexedDB save succeeded:', bgError);
          }
        }

        // Log analytics
        await this.logAnalytics(prompt.id, 'ai_response_save', {
          source: 'inline_button',
          aiPlatform: this.detectPageType(window.location.href),
          contentLength: cleanContent.length
        });

        this.showSaveNotification('AI response saved successfully!');
        
      } else {
        throw new Error('Failed to save AI response to IndexedDB');
      }
    } catch (error) {
      console.error('Failed to save AI response:', error);
      
      // Fallback: try background script only if extension context available
      if (this.chromeExtensionContext) {
        try {
          const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              action: "savePrompt",
              prompt: prompt
            }, (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response);
              }
            });
          });
          
          if (response && response.success) {
            console.log('AI response saved via background script fallback');
            this.showSaveNotification('AI response saved successfully!');
          } else {
            throw new Error('Background script save also failed');
          }
        } catch (fallbackError) {
          console.error('All save methods failed for AI response:', fallbackError);
          this.showErrorNotification('Failed to save AI response. Please try the extension popup.');
        }
      } else {
        this.showErrorNotification('Failed to save AI response. Please try refreshing the page.');
      }
    }
  }

  showSaveNotification(message = 'Saved to PromptHive!') {
    // Remove any existing notifications first
    const existingNotifications = document.querySelectorAll('.prompthive-notification');
    existingNotifications.forEach(notif => notif.remove());

    // Create and show a temporary notification
    const notification = document.createElement("div");
    notification.className = "prompthive-notification";
    notification.innerHTML = `
      <div class="prompthive-notification-content">
        <span class="prompthive-icon">✅</span>
        <span>${message}</span>
      </div>
    `;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
      notification.classList.add("show");
    }, 100);

    // Remove after 3 seconds
    setTimeout(() => {
      notification.classList.remove("show");
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  showErrorNotification(message = 'Failed to save prompt!') {
    // Remove any existing notifications first
    const existingNotifications = document.querySelectorAll('.prompthive-notification');
    existingNotifications.forEach(notif => notif.remove());

    // Create and show an error notification
    const notification = document.createElement("div");
    notification.className = "prompthive-notification error";
    notification.innerHTML = `
      <div class="prompthive-notification-content">
        <span class="prompthive-icon">❌</span>
        <span>${message}</span>
      </div>
    `;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
      notification.classList.add("show");
    }, 100);

    // Remove after 4 seconds (longer for error)
    setTimeout(() => {
      notification.classList.remove("show");
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 4000);
  }
}

// Initialize when page loads
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    new PromptInjector();
  });
} else {
  new PromptInjector();
}