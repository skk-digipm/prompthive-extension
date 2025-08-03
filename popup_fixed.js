// Enhanced Popup script for PromptHive with improved database integration

// Global references for event handlers
let promptHive;
let dbManager;

// Initialize the app when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
  console.log('DOM loaded, initializing PromptHive...');
  try {
    // Initialize database manager first
    if (typeof PromptHiveDatabase !== 'undefined') {
      dbManager = new PromptHiveDatabase();
      await dbManager.init();
      console.log('Database manager initialized successfully');
    }
    promptHive = new PromptHive();
  } catch (error) {
    console.error('Failed to initialize database manager:', error);
    promptHive = new PromptHive();
  }
});

// PromptHive Enhanced Popup Script with FIXED save functionality
class PromptHive {
  constructor() {
    this.prompts = [];
    this.editingIndex = null;
    this.filteredPrompts = [];
    this.dbManager = dbManager;
    this.currentPromptHistory = [];
    this.currentEnhancingIndex = null;
    this.stats = {
      totalPrompts: 0,
      totalTags: 0,
      totalUses: 0,
      avgUses: 0,
      mostUsedPrompt: null,
      categoryBreakdown: {},
      popularTags: []
    };
    this.init();
  }

  async init() {
    try {
      // Load prompts from database
      await this.loadPrompts();
      
      // Migrate old Chrome storage data if exists
      await this.migrateFromChromeStorage();
      
      // Bind events
      this.bindEvents();
      this.setupKeyboardShortcuts();
      
      console.log('PromptHive initialized successfully');
    } catch (error) {
      console.error('Failed to initialize PromptHive:', error);
      // Still bind events even if DB fails
      this.bindEvents();
      this.render();
    }
  }

  setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      // Escape to close modals
      if (e.key === "Escape") {
        this.closeModal();
        this.closeEnhancementModal();
        this.closeHistoryModal();
        this.closeDashboard();
      }
      
      // Ctrl/Cmd + K to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const searchInput = document.getElementById("searchInput");
        if (searchInput) searchInput.focus();
      }

      // Ctrl/Cmd + N to add new prompt
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        this.openModal();
      }

      // Ctrl/Cmd + D to open dashboard
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        this.openDashboard();
      }

      // Enter to save when modal is open
      if (e.key === "Enter" && e.ctrlKey) {
        const modalOverlay = document.getElementById("modalOverlay");
        if (modalOverlay && modalOverlay.style.display === "flex") {
          e.preventDefault();
          this.savePrompt();
        }
      }
    });
  }

  search(query) {
    const searchTerm = query.toLowerCase().trim();
    
    if (!searchTerm) {
      this.filteredPrompts = this.prompts;
    } else {
      this.filteredPrompts = this.prompts.filter(prompt => 
        prompt.title.toLowerCase().includes(searchTerm) ||
        prompt.text.toLowerCase().includes(searchTerm) ||
        prompt.tags.some(tag => tag.toLowerCase().includes(searchTerm))
      );
    }
    
    this.render();
  }

  // I'll continue with the rest of the methods from the original class...
  // This is just the beginning to establish the correct structure
}