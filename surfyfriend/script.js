const sidebar = document.getElementById("sidebar");
const menuToggle = document.getElementById("menuToggle");
const overlay = document.getElementById("sidebarOverlay");
const pageTitle = document.getElementById("pageTitle");
const pageEyebrow = document.getElementById("pageEyebrow");
const status = document.getElementById("status");
const urlInput = document.getElementById("url");
const filenameInput = document.getElementById("filename");
const themeToggle = document.getElementById("themeToggle");
const toolbarSearch = document.getElementById("toolbarSearch");
const toolbarAccountButton = document.getElementById("toolbarAccountButton");
const toolbarAccountDialog = document.getElementById("toolbarAccountDialog");
const toolbarToolsButton = document.getElementById("toolbarToolsButton");
const toolbarToolsMenu = document.getElementById("toolbarToolsMenu");
const shareStatus = document.getElementById("shareStatus");
const shareDialog = document.getElementById("shareDialog");
const shareUrlInput = document.getElementById("shareUrl");
const shareDialogStatus = document.getElementById("shareDialogStatus");
const historyList = document.getElementById("historyList");
const historyEmpty = document.getElementById("historyEmpty");
const historyNoResults = document.getElementById("historyNoResults");
const mediaUrlInput = document.getElementById("mediaUrl");
const mediaTypeSelect = document.getElementById("mediaType");
const mediaFileInput = document.getElementById("mediaFile");
const mediaPlayer = document.getElementById("mediaPlayer");
const mediaEmpty = document.getElementById("mediaEmpty");
const mediaTitle = document.getElementById("mediaTitle");
const mediaDetails = document.getElementById("mediaDetails");
const mediaStatus = document.getElementById("mediaStatus");
const clearMediaButton = document.getElementById("clearMedia");
let activeMediaObjectUrl = null;
let mediaLoadVersion = 0;

const HISTORY_KEY = "dropzone.downloadHistory";
const QUEUE_KEY = "dropzone.downloadQueue";
// Preserve existing theme preferences across the SurfyFriend rename.
const THEME_KEY = "dropzone.theme";
const PROGRESS_KEY = "dropzone.progress";
const SOUND_KEY = "dropzone.soundEffects";
const themes = ["light", "dark", "ocean", "sunset", "forest", "midnight"];
const themeLabels = {
    light: "Light",
    dark: "Dark",
    ocean: "Ocean",
    sunset: "Sunset",
    forest: "Forest",
    midnight: "Midnight",
};
const historyLimit = 50;
const queueLimit = 50;
let activeAchievementFilter = "all";
let activeSiteFilter = "all";
let pageLinkCandidates = [];
let puterSdkPromise = null;
let accountUsername = "";
let accountSyncEnabled = false;
let accountSyncTimer = null;
let accountSyncChain = Promise.resolve();
let soundEffectsEnabled = false;
let audioContext = null;
let currentPageName = "home";
let fullVersionAvailable = false;
let fullVersionStatusKnown = false;
const fullVersionOnlyPages = new Set([
    "achievements",
    "checker",
    "explorer",
    "helper",
    "history",
    "media",
    "queue",
    "sites",
    "uploads",
]);
let pageNavigationHistory = [];
let activeGamepadIndex = null;
let gamepadFrame = 0;
let lastGamepadDirectionAt = 0;
let previousGamepadButtons = [];
try {
    soundEffectsEnabled = localStorage.getItem(SOUND_KEY) === "on";
} catch (error) {
    console.error("Could not read SurfyFriend sound preference.", error);
}

function playUiSound(kind = "click") {
    if (!soundEffectsEnabled) {
        return;
    }
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) {
        return;
    }
    try {
        audioContext ||= new AudioContextType();
        if (audioContext.state === "suspended") {
            audioContext.resume().catch((error) => {
                console.error("Could not resume SurfyFriend sound effects.", error);
            });
        }
        const notes = kind === "achievement" ? [660, 880, 1100] :
            kind === "success" ? [523, 784] : [440];
        const start = audioContext.currentTime;
        notes.forEach((frequency, index) => {
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            const noteStart = start + index * 0.075;
            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(frequency, noteStart);
            gain.gain.setValueAtTime(0.0001, noteStart);
            gain.gain.exponentialRampToValueAtTime(0.035, noteStart + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.11);
            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            oscillator.start(noteStart);
            oscillator.stop(noteStart + 0.12);
        });
    } catch (error) {
        console.error("Could not play SurfyFriend sound effect.", error);
    }
}

function visitedSiteCategoryCount(activity) {
    return [
        activity.softwareSiteVisits,
        activity.mediaSiteVisits,
        activity.bookSiteVisits,
        activity.dataSiteVisits,
        activity.socialSiteVisits,
        activity.entertainmentSiteVisits,
        activity.gamesSiteVisits,
    ].filter((visits) => visits > 0).length;
}

const achievementDefinitions = [
    {
        id: "first-link",
        icon: "↗",
        title: "First Link",
        description: "Open your first direct link.",
        requirement: (activity) => activity.linksOpened >= 1,
        progress: (activity) => `${Math.min(activity.linksOpened, 1)} / 1 link opened`,
        bonus: 10,
    },
    {
        id: "queue-curator",
        icon: "☷",
        title: "Queue Curator",
        description: "Add five links to your queue.",
        requirement: (activity) => activity.queueItemsAdded >= 5,
        progress: (activity) => `${Math.min(activity.queueItemsAdded, 5)} / 5 links added`,
        bonus: 15,
    },
    {
        id: "media-explorer",
        icon: "♫",
        title: "Media Explorer",
        description: "Preview media in SurfyFriend.",
        requirement: (activity) => activity.mediaPreviews >= 1,
        progress: (activity) => `${Math.min(activity.mediaPreviews, 1)} / 1 preview`,
        bonus: 10,
    },
    {
        id: "shelf-keeper",
        icon: "▤",
        title: "Shelf Keeper",
        description: "Save a file to your local shelf.",
        requirement: (activity) => activity.filesUploaded >= 1,
        progress: (activity) => `${Math.min(activity.filesUploaded, 1)} / 1 file saved`,
        bonus: 10,
    },
    {
        id: "link-explorer",
        icon: "✧",
        title: "Link Explorer",
        description: "Open ten direct links.",
        requirement: (activity) => activity.linksOpened >= 10,
        progress: (activity) => `${Math.min(activity.linksOpened, 10)} / 10 links opened`,
        bonus: 20,
    },
    {
        id: "link-pair",
        icon: "↗",
        title: "Link Pair",
        description: "Open two direct links.",
        requirement: (activity) => activity.linksOpened >= 2,
        progress: (activity) => `${Math.min(activity.linksOpened, 2)} / 2 links opened`,
        bonus: 5,
    },
    {
        id: "link-collector",
        icon: "⌁",
        title: "Link Collector",
        description: "Open 25 direct links.",
        requirement: (activity) => activity.linksOpened >= 25,
        progress: (activity) => `${Math.min(activity.linksOpened, 25)} / 25 links opened`,
        bonus: 25,
    },
    {
        id: "link-pathfinder",
        icon: "✧",
        title: "Link Pathfinder",
        description: "Open 50 direct links.",
        requirement: (activity) => activity.linksOpened >= 50,
        progress: (activity) => `${Math.min(activity.linksOpened, 50)} / 50 links opened`,
        bonus: 40,
    },
    {
        id: "queue-starter",
        icon: "☷",
        title: "Queue Starter",
        description: "Add your first link to the queue.",
        requirement: (activity) => activity.queueItemsAdded >= 1,
        progress: (activity) => `${Math.min(activity.queueItemsAdded, 1)} / 1 link added`,
        bonus: 5,
    },
    {
        id: "batch-builder",
        icon: "▤",
        title: "Batch Builder",
        description: "Add a batch of links to your queue.",
        requirement: (activity) => activity.batchAdds >= 1,
        progress: (activity) => `${Math.min(activity.batchAdds, 1)} / 1 batch added`,
        bonus: 10,
    },
    {
        id: "queue-regular",
        icon: "☷",
        title: "Queue Regular",
        description: "Add ten links to your queue.",
        requirement: (activity) => activity.queueItemsAdded >= 10,
        progress: (activity) => `${Math.min(activity.queueItemsAdded, 10)} / 10 links added`,
        bonus: 25,
    },
    {
        id: "first-in-line",
        icon: "→",
        title: "First in Line",
        description: "Open a link from your queue.",
        requirement: (activity) => activity.queueLinksOpened >= 1,
        progress: (activity) => `${Math.min(activity.queueLinksOpened, 1)} / 1 queued link opened`,
        bonus: 10,
    },
    {
        id: "queue-navigator",
        icon: "⌖",
        title: "Queue Navigator",
        description: "Open ten links from your queue.",
        requirement: (activity) => activity.queueLinksOpened >= 10,
        progress: (activity) => `${Math.min(activity.queueLinksOpened, 10)} / 10 queued links opened`,
        bonus: 25,
    },
    {
        id: "image-viewer",
        icon: "▧",
        title: "Image Viewer",
        description: "Preview an image in SurfyFriend.",
        requirement: (activity) => activity.imagePreviews >= 1,
        progress: (activity) => `${Math.min(activity.imagePreviews, 1)} / 1 image previewed`,
        bonus: 10,
    },
    {
        id: "audio-listener",
        icon: "♫",
        title: "Audio Listener",
        description: "Load an audio preview in SurfyFriend.",
        requirement: (activity) => activity.audioPreviews >= 1,
        progress: (activity) => `${Math.min(activity.audioPreviews, 1)} / 1 audio preview`,
        bonus: 10,
    },
    {
        id: "video-viewer",
        icon: "▶",
        title: "Video Viewer",
        description: "Load a video preview in SurfyFriend.",
        requirement: (activity) => activity.videoPreviews >= 1,
        progress: (activity) => `${Math.min(activity.videoPreviews, 1)} / 1 video preview`,
        bonus: 10,
    },
    {
        id: "gallery-curator",
        icon: "▧",
        title: "Gallery Curator",
        description: "Preview ten images.",
        requirement: (activity) => activity.imagePreviews >= 10,
        progress: (activity) => `${Math.min(activity.imagePreviews, 10)} / 10 images previewed`,
        bonus: 20,
    },
    {
        id: "playlist-starter",
        icon: "♫",
        title: "Playlist Starter",
        description: "Preview five audio files.",
        requirement: (activity) => activity.audioPreviews >= 5,
        progress: (activity) => `${Math.min(activity.audioPreviews, 5)} / 5 audio previews`,
        bonus: 15,
    },
    {
        id: "movie-night",
        icon: "▶",
        title: "Movie Night",
        description: "Preview five video files.",
        requirement: (activity) => activity.videoPreviews >= 5,
        progress: (activity) => `${Math.min(activity.videoPreviews, 5)} / 5 video previews`,
        bonus: 15,
    },
    {
        id: "shelf-builder",
        icon: "▤",
        title: "Shelf Builder",
        description: "Save five files to your local shelf.",
        requirement: (activity) => activity.filesUploaded >= 5,
        progress: (activity) => `${Math.min(activity.filesUploaded, 5)} / 5 files saved`,
        bonus: 20,
    },
    {
        id: "file-librarian",
        icon: "▤",
        title: "File Librarian",
        description: "Save ten files to your local shelf.",
        requirement: (activity) => activity.filesUploaded >= 10,
        progress: (activity) => `${Math.min(activity.filesUploaded, 10)} / 10 files saved`,
        bonus: 30,
    },
    {
        id: "well-rounded",
        icon: "✦",
        title: "Well-Rounded",
        description: "Try links, the queue, media, and your local shelf.",
        requirement: (activity) =>
            activity.linksOpened >= 1 &&
            activity.queueItemsAdded >= 1 &&
            activity.mediaPreviews >= 1 &&
            activity.filesUploaded >= 1,
        progress: (activity) => [
            activity.linksOpened >= 1 ? "link" : null,
            activity.queueItemsAdded >= 1 ? "queue" : null,
            activity.mediaPreviews >= 1 ? "media" : null,
            activity.filesUploaded >= 1 ? "shelf" : null,
        ].filter(Boolean).join(" · ") || "Try all four SurfyFriend tools",
        bonus: 30,
    },
    {
        id: "visual-storyteller",
        icon: "▧",
        title: "Visual Storyteller",
        description: "Preview 25 images.",
        requirement: (activity) => activity.imagePreviews >= 25,
        progress: (activity) => `${Math.min(activity.imagePreviews, 25)} / 25 images previewed`,
        bonus: 30,
    },
    {
        id: "sound-collector",
        icon: "♫",
        title: "Sound Collector",
        description: "Preview 25 audio files.",
        requirement: (activity) => activity.audioPreviews >= 25,
        progress: (activity) => `${Math.min(activity.audioPreviews, 25)} / 25 audio previews`,
        bonus: 30,
    },
    {
        id: "format-explorer",
        icon: "✹",
        title: "Format Explorer",
        description: "Preview 25 media files.",
        requirement: (activity) => activity.mediaPreviews >= 25,
        progress: (activity) => `${Math.min(activity.mediaPreviews, 25)} / 25 media previews`,
        bonus: 30,
    },
    {
        id: "page-scout",
        icon: "⌕",
        title: "Page Scout",
        description: "Scan a public webpage for file links.",
        requirement: (activity) => activity.pageScans >= 1,
        progress: (activity) => `${Math.min(activity.pageScans, 1)} / 1 page scanned`,
        bonus: 10,
    },
    {
        id: "page-reader",
        icon: "⌕",
        title: "Page Reader",
        description: "Scan five public webpages.",
        requirement: (activity) => activity.pageScans >= 5,
        progress: (activity) => `${Math.min(activity.pageScans, 5)} / 5 pages scanned`,
        bonus: 15,
    },
    {
        id: "page-pathfinder",
        icon: "⌕",
        title: "Page Pathfinder",
        description: "Scan ten public webpages.",
        requirement: (activity) => activity.pageScans >= 10,
        progress: (activity) => `${Math.min(activity.pageScans, 10)} / 10 pages scanned`,
        bonus: 20,
    },
    {
        id: "webpage-cartographer",
        icon: "⌕",
        title: "Webpage Cartographer",
        description: "Scan 25 public webpages.",
        requirement: (activity) => activity.pageScans >= 25,
        progress: (activity) => `${Math.min(activity.pageScans, 25)} / 25 pages scanned`,
        bonus: 30,
    },
    {
        id: "page-picker",
        icon: "☑",
        title: "Page Picker",
        description: "Add a discovered webpage link to your queue.",
        requirement: (activity) => activity.pageLinksQueued >= 1,
        progress: (activity) => `${Math.min(activity.pageLinksQueued, 1)} / 1 discovered link queued`,
        bonus: 10,
    },
    {
        id: "page-curator",
        icon: "☑",
        title: "Page Curator",
        description: "Queue five links found on webpages.",
        requirement: (activity) => activity.pageLinksQueued >= 5,
        progress: (activity) => `${Math.min(activity.pageLinksQueued, 5)} / 5 discovered links queued`,
        bonus: 15,
    },
    {
        id: "link-harvester",
        icon: "☑",
        title: "Link Harvester",
        description: "Queue 20 links found on webpages.",
        requirement: (activity) => activity.pageLinksQueued >= 20,
        progress: (activity) => `${Math.min(activity.pageLinksQueued, 20)} / 20 discovered links queued`,
        bonus: 25,
    },
    {
        id: "cloud-first",
        icon: "☁",
        title: "Cloud Explorer",
        description: "Open a supported cloud share.",
        requirement: (activity) => activity.cloudLinksOpened >= 1,
        progress: (activity) => `${Math.min(activity.cloudLinksOpened, 1)} / 1 cloud share opened`,
        bonus: 10,
    },
    {
        id: "cloud-regular",
        icon: "☁",
        title: "Cloud Traveler",
        description: "Open five supported cloud shares.",
        requirement: (activity) => activity.cloudLinksOpened >= 5,
        progress: (activity) => `${Math.min(activity.cloudLinksOpened, 5)} / 5 cloud shares opened`,
        bonus: 15,
    },
    {
        id: "cloud-librarian",
        icon: "☁",
        title: "Cloud Librarian",
        description: "Open 20 supported cloud shares.",
        requirement: (activity) => activity.cloudLinksOpened >= 20,
        progress: (activity) => `${Math.min(activity.cloudLinksOpened, 20)} / 20 cloud shares opened`,
        bonus: 25,
    },
    {
        id: "source-first",
        icon: "↗",
        title: "Source Visitor",
        description: "Visit a site from the curated guide.",
        requirement: (activity) => activity.siteLinksOpened >= 1,
        progress: (activity) => `${Math.min(activity.siteLinksOpened, 1)} / 1 suggested source opened`,
        bonus: 10,
    },
    {
        id: "source-hopper",
        icon: "↗",
        title: "Source Hopper",
        description: "Visit five sites from the curated guide.",
        requirement: (activity) => activity.siteLinksOpened >= 5,
        progress: (activity) => `${Math.min(activity.siteLinksOpened, 5)} / 5 suggested sources opened`,
        bonus: 15,
    },
    {
        id: "source-explorer",
        icon: "↗",
        title: "Source Explorer",
        description: "Visit ten sites from the curated guide.",
        requirement: (activity) => activity.siteLinksOpened >= 10,
        progress: (activity) => `${Math.min(activity.siteLinksOpened, 10)} / 10 suggested sources opened`,
        bonus: 20,
    },
    {
        id: "resource-regular",
        icon: "↗",
        title: "Resource Regular",
        description: "Visit 25 sites from the curated guide.",
        requirement: (activity) => activity.siteLinksOpened >= 25,
        progress: (activity) => `${Math.min(activity.siteLinksOpened, 25)} / 25 suggested sources opened`,
        bonus: 30,
    },
    {
        id: "software-scout",
        icon: "⚙",
        title: "Software Scout",
        description: "Visit an official software source.",
        requirement: (activity) => activity.softwareSiteVisits >= 1,
        progress: (activity) => `${Math.min(activity.softwareSiteVisits, 1)} / 1 software source opened`,
        bonus: 10,
    },
    {
        id: "software-collector",
        icon: "⚙",
        title: "Software Collector",
        description: "Visit five official software sources.",
        requirement: (activity) => activity.softwareSiteVisits >= 5,
        progress: (activity) => `${Math.min(activity.softwareSiteVisits, 5)} / 5 software sources opened`,
        bonus: 15,
    },
    {
        id: "media-scout",
        icon: "▧",
        title: "Media Scout",
        description: "Visit an openly available media source.",
        requirement: (activity) => activity.mediaSiteVisits >= 1,
        progress: (activity) => `${Math.min(activity.mediaSiteVisits, 1)} / 1 media source opened`,
        bonus: 10,
    },
    {
        id: "media-collector",
        icon: "▧",
        title: "Media Collector",
        description: "Visit five openly available media sources.",
        requirement: (activity) => activity.mediaSiteVisits >= 5,
        progress: (activity) => `${Math.min(activity.mediaSiteVisits, 5)} / 5 media sources opened`,
        bonus: 15,
    },
    {
        id: "book-scout",
        icon: "▤",
        title: "Book Scout",
        description: "Visit a books or learning source.",
        requirement: (activity) => activity.bookSiteVisits >= 1,
        progress: (activity) => `${Math.min(activity.bookSiteVisits, 1)} / 1 book source opened`,
        bonus: 10,
    },
    {
        id: "book-collector",
        icon: "▤",
        title: "Book Collector",
        description: "Visit five books or learning sources.",
        requirement: (activity) => activity.bookSiteVisits >= 5,
        progress: (activity) => `${Math.min(activity.bookSiteVisits, 5)} / 5 book sources opened`,
        bonus: 15,
    },
    {
        id: "data-scout",
        icon: "▦",
        title: "Data Scout",
        description: "Visit an open-data source.",
        requirement: (activity) => activity.dataSiteVisits >= 1,
        progress: (activity) => `${Math.min(activity.dataSiteVisits, 1)} / 1 data source opened`,
        bonus: 10,
    },
    {
        id: "data-collector",
        icon: "▦",
        title: "Data Collector",
        description: "Visit five open-data sources.",
        requirement: (activity) => activity.dataSiteVisits >= 5,
        progress: (activity) => `${Math.min(activity.dataSiteVisits, 5)} / 5 data sources opened`,
        bonus: 15,
    },
    {
        id: "account-data-steward",
        icon: "♧",
        title: "Account Data Steward",
        description: "Visit an official social-account export tool.",
        requirement: (activity) => activity.socialSiteVisits >= 1,
        progress: (activity) => `${Math.min(activity.socialSiteVisits, 1)} / 1 official export source opened`,
        bonus: 15,
    },
    {
        id: "account-data-explorer",
        icon: "♧",
        title: "Account Data Explorer",
        description: "Visit five official social-account export links.",
        requirement: (activity) => activity.socialSiteVisits >= 5,
        progress: (activity) => `${Math.min(activity.socialSiteVisits, 5)} / 5 official export links opened`,
        bonus: 20,
    },
    {
        id: "category-sampler",
        icon: "✧",
        title: "Category Sampler",
        description: "Explore four kinds of suggested sources.",
        requirement: (activity) => visitedSiteCategoryCount(activity) >= 4,
        progress: (activity) => `${visitedSiteCategoryCount(activity)} / 4 categories explored`,
        bonus: 20,
    },
    {
        id: "full-catalog-tour",
        icon: "✧",
        title: "Full Catalog Tour",
        description: "Explore five kinds of suggested sources.",
        requirement: (activity) => visitedSiteCategoryCount(activity) >= 5,
        progress: (activity) => `${Math.min(visitedSiteCategoryCount(activity), 5)} / 5 categories explored`,
        bonus: 30,
    },
    {
        id: "scan-and-save",
        icon: "⌕",
        title: "Scan and Save",
        description: "Scan a webpage and queue a link you found.",
        requirement: (activity) => activity.pageScans >= 1 && activity.pageLinksQueued >= 1,
        progress: (activity) => [
            activity.pageScans >= 1 ? "page scanned" : "scan a page",
            activity.pageLinksQueued >= 1 ? "link queued" : "queue a found link",
        ].join(" · "),
        bonus: 20,
    },
    {
        id: "cloud-batch",
        icon: "☁",
        title: "Cloud Batch",
        description: "Open a cloud share from your download queue.",
        requirement: (activity) => activity.cloudLinksOpened >= 1 && activity.batchAdds >= 1,
        progress: (activity) => [
            activity.cloudLinksOpened >= 1 ? "cloud share opened" : "open a cloud share",
            activity.batchAdds >= 1 ? "batch added" : "add a batch",
        ].join(" · "),
        bonus: 20,
    },
    {
        id: "format-trio",
        icon: "✹",
        title: "Format Trio",
        description: "Preview an image, audio file, and video.",
        requirement: (activity) =>
            activity.imagePreviews >= 1 &&
            activity.audioPreviews >= 1 &&
            activity.videoPreviews >= 1,
        progress: (activity) => [
            `${Math.min(activity.imagePreviews, 1)} / 1 image`,
            `${Math.min(activity.audioPreviews, 1)} / 1 audio`,
            `${Math.min(activity.videoPreviews, 1)} / 1 video`,
        ].join(" · "),
        bonus: 30,
    },
    {
        id: "link-veteran",
        icon: "↗",
        title: "Link Veteran",
        description: "Open 100 direct or shared links.",
        requirement: (activity) => activity.linksOpened >= 100,
        progress: (activity) => `${Math.min(activity.linksOpened, 100)} / 100 links opened`,
        bonus: 50,
    },
    {
        id: "website-first-step",
        icon: "⌖",
        title: "First Stop",
        description: "Explore your first unique website address.",
        requirement: (activity) => activity.websiteVisits >= 1,
        progress: (activity) => `${Math.min(activity.websiteVisits, 1)} / 1 unique website`,
        bonus: 10,
    },
    {
        id: "website-curious-clicker",
        icon: "✧",
        title: "Curious Clicker",
        description: "Explore five different website addresses.",
        requirement: (activity) => activity.websiteVisits >= 5,
        progress: (activity) => `${Math.min(activity.websiteVisits, 5)} / 5 unique websites`,
        bonus: 15,
    },
    {
        id: "website-world-tourist",
        icon: "⌖",
        title: "World Tourist",
        description: "Explore ten different website addresses.",
        requirement: (activity) => activity.websiteVisits >= 10,
        progress: (activity) => `${Math.min(activity.websiteVisits, 10)} / 10 unique websites`,
        bonus: 25,
    },
    {
        id: "website-globetrotter",
        icon: "✧",
        title: "Digital Globetrotter",
        description: "Explore 25 different website addresses.",
        requirement: (activity) => activity.websiteVisits >= 25,
        progress: (activity) => `${Math.min(activity.websiteVisits, 25)} / 25 unique websites`,
        bonus: 40,
    },
    {
        id: "entertainment-fan",
        icon: "♫",
        title: "Entertainment Fan",
        description: "Visit an entertainment source from the suggested list.",
        requirement: (activity) => activity.entertainmentSiteVisits >= 1,
        progress: (activity) => `${Math.min(activity.entertainmentSiteVisits, 1)} / 1 entertainment source`,
        bonus: 10,
    },
    {
        id: "game-explorer",
        icon: "🎮",
        title: "Game Explorer",
        description: "Visit a games source from the suggested list.",
        requirement: (activity) => activity.gamesSiteVisits >= 1,
        progress: (activity) => `${Math.min(activity.gamesSiteVisits, 1)} / 1 games source`,
        bonus: 10,
    },
];
const progressLevels = [
    { name: "Curious Starter", minimumXp: 0 },
    { name: "Link Scout", minimumXp: 60 },
    { name: "File Finder", minimumXp: 150 },
    { name: "SurfyFriend Star", minimumXp: 300 },
];
const siteCategories = {
    software: "Software",
    media: "Media",
    books: "Books and learning",
    data: "Open data",
    social: "Social-account exports",
    entertainment: "Entertainment",
    games: "Games",
};
const siteVisitCounters = {
    software: "softwareSiteVisits",
    media: "mediaSiteVisits",
    books: "bookSiteVisits",
    data: "dataSiteVisits",
    social: "socialSiteVisits",
    entertainment: "entertainmentSiteVisits",
    games: "gamesSiteVisits",
};
const suggestedSites = [
    {
        id: "mozilla",
        category: "software",
        name: "Mozilla Firefox",
        url: "https://www.mozilla.org/firefox/new/",
        description: "Get the Firefox browser from its official project site.",
        note: "Check the platform and system requirements before installing.",
    },
    {
        id: "libreoffice",
        category: "software",
        name: "LibreOffice",
        url: "https://www.libreoffice.org/download/download-libreoffice/",
        description: "Download the free, open-source office suite.",
        note: "Use the official download page for current installers.",
    },
    {
        id: "vlc",
        category: "software",
        name: "VLC media player",
        url: "https://www.videolan.org/vlc/",
        description: "Get VLC from the VideoLAN project.",
        note: "Avoid third-party installer mirrors.",
    },
    {
        id: "blender",
        category: "software",
        name: "Blender",
        url: "https://www.blender.org/download/",
        description: "Download the open-source 3D creation suite.",
        note: "Choose the official build for your operating system.",
    },
    {
        id: "gimp",
        category: "software",
        name: "GIMP",
        url: "https://www.gimp.org/downloads/",
        description: "Get the free image editor from its official project.",
        note: "Download from the project site, not an ad or mirror.",
    },
    {
        id: "commons",
        category: "media",
        name: "Wikimedia Commons",
        url: "https://commons.wikimedia.org/",
        description: "Browse images, audio, and video shared by the community.",
        note: "Licenses and attribution requirements differ for each item.",
    },
    {
        id: "openverse",
        category: "media",
        name: "Openverse",
        url: "https://openverse.org/",
        description: "Search openly licensed images and audio.",
        note: "Confirm the license and attribution details on the original source.",
    },
    {
        id: "nasa-media",
        category: "media",
        name: "NASA Images and Video",
        url: "https://images.nasa.gov/",
        description: "Explore NASA's public image, audio, and video collection.",
        note: "Some items may include third-party material; review each item's terms.",
    },
    {
        id: "internet-archive",
        category: "media",
        name: "Internet Archive",
        url: "https://archive.org/",
        description: "Explore a large collection of digitized media and public resources.",
        note: "Rights vary by item; follow its access and reuse terms.",
    },
    {
        id: "pbs",
        category: "entertainment",
        name: "PBS",
        url: "https://www.pbs.org/",
        description: "Watch programs and explore documentaries from public television.",
        note: "Programs and streaming availability vary by location.",
    },
    {
        id: "nasa-plus",
        category: "entertainment",
        name: "NASA+",
        url: "https://plus.nasa.gov/",
        description: "Watch NASA documentaries, live coverage, and space stories.",
        note: "Review usage terms for individual media before reusing it.",
    },
    {
        id: "bandcamp",
        category: "entertainment",
        name: "Bandcamp",
        url: "https://bandcamp.com/",
        description: "Discover music and support artists directly.",
        note: "Downloads depend on each artist's settings and purchase terms.",
    },
    {
        id: "radio-garden",
        category: "entertainment",
        name: "Radio Garden",
        url: "https://radio.garden/",
        description: "Explore live radio stations from around the world.",
        note: "Stations and listening availability vary by region.",
    },
    {
        id: "kanopy",
        category: "entertainment",
        name: "Kanopy",
        url: "https://www.kanopy.com/",
        description: "Stream films and documentaries through participating libraries.",
        note: "A participating library, university, or valid account may be required.",
    },
    {
        id: "nfb",
        category: "entertainment",
        name: "National Film Board of Canada",
        url: "https://www.nfb.ca/",
        description: "Watch documentaries, animation, and interactive stories.",
        note: "Availability and reuse rights vary by title.",
    },
    {
        id: "ted",
        category: "entertainment",
        name: "TED",
        url: "https://www.ted.com/",
        description: "Watch talks and short programs from speakers around the world.",
        note: "Review TED's terms before downloading or reusing talks.",
    },
    {
        id: "soundcloud",
        category: "entertainment",
        name: "SoundCloud",
        url: "https://soundcloud.com/",
        description: "Discover music, podcasts, and independent creators.",
        note: "Listening and downloads depend on the creator's settings and service terms.",
    },
    {
        id: "spotify",
        category: "entertainment",
        name: "Spotify",
        url: "https://open.spotify.com/",
        description: "Listen to music, podcasts, and audiobooks where available.",
        note: "An account may be required; offline listening follows Spotify's subscription rules.",
    },
    {
        id: "crunchyroll",
        category: "entertainment",
        name: "Crunchyroll",
        url: "https://www.crunchyroll.com/",
        description: "Stream anime and explore related entertainment.",
        note: "Availability varies by region; use the service's official viewing options.",
    },
    {
        id: "games-steam",
        category: "games",
        name: "Steam",
        url: "https://store.steampowered.com/",
        description: "Browse PC games, including free-to-play titles and demos.",
        note: "Games may require an account, purchase, or the Steam app.",
    },
    {
        id: "games-gog",
        category: "games",
        name: "GOG",
        url: "https://www.gog.com/",
        description: "Find PC games, including classic and DRM-free releases.",
        note: "Check each game's price, system requirements, and terms.",
    },
    {
        id: "games-itch",
        category: "games",
        name: "itch.io",
        url: "https://itch.io/",
        description: "Discover independent games, including free and pay-what-you-want releases.",
        note: "Check each creator's page and download terms.",
    },
    {
        id: "games-scratch",
        category: "games",
        name: "Scratch",
        url: "https://scratch.mit.edu/",
        description: "Play and create games and interactive stories in your browser.",
        note: "Community projects have their own sharing and remix rules.",
    },
    {
        id: "games-boardgamearena",
        category: "games",
        name: "Board Game Arena",
        url: "https://boardgamearena.com/",
        description: "Play a wide range of board games online with friends.",
        note: "Some games or features may require an account or subscription.",
    },
    {
        id: "games-epic",
        category: "games",
        name: "Epic Games Store",
        url: "https://store.epicgames.com/",
        description: "Browse PC games, free games, and game demos.",
        note: "Purchases, accounts, and the Epic Games launcher may be required.",
    },
    {
        id: "games-crazygames",
        category: "games",
        name: "CrazyGames",
        url: "https://www.crazygames.com/",
        description: "Try a large collection of games that run in a web browser.",
        note: "The site includes advertising and third-party games; check privacy settings.",
    },
    {
        id: "games-poki",
        category: "games",
        name: "Poki",
        url: "https://poki.com/",
        description: "Play browser-based games without installing a desktop launcher.",
        note: "Game availability and ads may vary by region and device.",
    },
    {
        id: "games-pico8",
        category: "games",
        name: "Lexaloffle PICO-8",
        url: "https://www.lexaloffle.com/pico-8.php",
        description: "Explore a fantasy console and a community library of tiny games.",
        note: "Some features and the desktop console are paid.",
    },
    {
        id: "games-humble",
        category: "games",
        name: "Humble Store",
        url: "https://www.humblebundle.com/store",
        description: "Browse PC games and bundles, including occasional demos and free offers.",
        note: "Check platform compatibility and each product's purchase terms.",
    },
    {
        id: "gutenberg",
        category: "books",
        name: "Project Gutenberg",
        url: "https://www.gutenberg.org/",
        description: "Read and download many older books at no cost.",
        note: "Public-domain status can differ outside the United States.",
    },
    {
        id: "standard-ebooks",
        category: "books",
        name: "Standard Ebooks",
        url: "https://standardebooks.org/",
        description: "Find carefully formatted public-domain ebooks.",
        note: "Review the site's terms for reuse and redistribution.",
    },
    {
        id: "librivox",
        category: "books",
        name: "LibriVox",
        url: "https://librivox.org/",
        description: "Listen to volunteer-recorded public-domain audiobooks.",
        note: "Book rights may differ by country.",
    },
    {
        id: "mit-ocw",
        category: "books",
        name: "MIT OpenCourseWare",
        url: "https://ocw.mit.edu/",
        description: "Browse free course materials published by MIT.",
        note: "Materials may have different reuse licenses; check each course.",
    },
    {
        id: "data-gov",
        category: "data",
        name: "Data.gov",
        url: "https://data.gov/",
        description: "Find U.S. government datasets and data tools.",
        note: "Check the dataset page for source, terms, and update date.",
    },
    {
        id: "zenodo",
        category: "data",
        name: "Zenodo",
        url: "https://zenodo.org/",
        description: "Discover research outputs and datasets shared by researchers.",
        note: "Each record has its own license and access terms.",
    },
    {
        id: "huggingface-datasets",
        category: "data",
        name: "Hugging Face Datasets",
        url: "https://huggingface.co/datasets",
        description: "Browse community datasets for research and machine learning.",
        note: "Review the dataset card, license, and intended use before downloading.",
    },
    {
        id: "world-bank-data",
        category: "data",
        name: "World Bank Open Data",
        url: "https://data.worldbank.org/",
        description: "Explore global development indicators and related datasets.",
        note: "Review the specific dataset's attribution and reuse terms.",
    },
    {
        id: "google-takeout",
        category: "social",
        name: "Google Takeout",
        url: "https://takeout.google.com/",
        description: "Export data from your own Google account.",
        note: "This is for your account data, not downloading other people's media.",
    },
    {
        id: "meta-accounts-center",
        category: "social",
        name: "Meta Accounts Center",
        url: "https://accountscenter.instagram.com/info_and_permissions/",
        description: "Manage or export information from your own Meta account.",
        note: "Sign in to your account and use the official export controls.",
    },
    {
        id: "tiktok-data",
        category: "social",
        name: "TikTok data request help",
        url: "https://support.tiktok.com/en/account-and-privacy/personalized-ads-and-data/requesting-your-data",
        description: "Learn how to request a copy of your own TikTok account data.",
        note: "Use the platform's official process; this does not download other users' videos.",
    },
];
const pageDetails = {
    home: { title: "Overview", eyebrow: "YOUR FILES, YOUR WAY" },
    downloader: { title: "Downloader", eyebrow: "FILES, SHARES & WEB PAGES" },
    sites: { title: "Suggested websites", eyebrow: "A GOOD PLACE TO START" },
    explorer: { title: "Website Explorer", eyebrow: "GO SOMEWHERE NEW" },
    checker: { title: "Website checker", eyebrow: "CHECK BEFORE YOU VISIT" },
    media: { title: "Media player", eyebrow: "PLAY OR PREVIEW MEDIA" },
    queue: { title: "Download queue", eyebrow: "PLAN YOUR DOWNLOADS" },
    uploads: { title: "My uploads", eyebrow: "STORED ON THIS COMPUTER" },
    helper: { title: "AI helper", eyebrow: "PRIVATE, BUILT-IN GUIDANCE" },
    history: { title: "Download history", eyebrow: "YOUR RECENT LINKS" },
    achievements: { title: "Achievements", eyebrow: "YOUR PROGRESS, YOUR PACE" },
    settings: { title: "Settings", eyebrow: "MAKE YOURSELF AT HOME" },
};

function renderSiteCards(sites, container) {
    container.replaceChildren();
    sites.forEach((site) => {
        const card = document.createElement("article");
        card.className = "site-card";
        const category = document.createElement("span");
        category.className = "site-category";
        category.textContent = site.aiSuggested
            ? `${siteCategories[site.category]} · AI suggestion`
            : siteCategories[site.category];
        if (site.aiSuggested) {
            card.classList.add("ai-suggested");
        }
        const title = document.createElement("h3");
        title.textContent = site.name;
        const description = document.createElement("p");
        description.textContent = site.description;
        const note = document.createElement("p");
        note.className = "site-note";
        note.textContent = site.note;
        const link = document.createElement("a");
        link.href = site.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Visit official website ↗";
        link.setAttribute("aria-label", `Visit ${site.name} in a new tab`);
        link.addEventListener("click", () => {
            recordWebsiteVisit(
                site.url,
                site.aiSuggested ? "" : site.category,
                `${site.name} opened`
            );
        });
        card.append(category, title, description, note, link);
        container.append(card);
    });
}

function normalizeWebsiteUrl(value) {
    const trimmed = value.trim();
    const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
    const input = hasScheme ? trimmed : `https://${trimmed}`;
    let url;
    try {
        url = new URL(input);
    } catch {
        return { error: "Enter a complete website address, such as example.com." };
    }
    if (!["http:", "https:"].includes(url.protocol)) {
        return { error: "For safety, Website Explorer only opens http:// and https:// addresses." };
    }
    if (url.username || url.password || !url.hostname) {
        return { error: "Enter a website address without a username or password." };
    }
    url.hash = "";
    url.searchParams.sort();
    return { url };
}

function renderExplorerHistory() {
    const recentList = document.getElementById("explorerRecentList");
    const urls = progress.visitedWebsiteUrls;
    recentList.replaceChildren();
    document.getElementById("explorerVisitCount").textContent =
        `${progress.websiteVisits} unique ${progress.websiteVisits === 1 ? "website" : "websites"} explored on this device`;
    document.getElementById("explorerHistoryEmpty").hidden = urls.length > 0;
    urls.slice(-5).reverse().forEach((value) => {
        const url = new URL(value);
        const row = document.createElement("div");
        row.className = "explorer-recent-item";
        const details = document.createElement("div");
        details.className = "explorer-recent-details";
        const host = document.createElement("strong");
        host.textContent = url.hostname;
        const address = document.createElement("span");
        address.textContent = `${url.pathname}${url.search}`;
        address.title = value;
        const revisit = document.createElement("a");
        revisit.href = value;
        revisit.target = "_blank";
        revisit.rel = "noopener noreferrer";
        revisit.textContent = "Visit again ↗";
        revisit.addEventListener("click", () => {
            recordWebsiteVisit(value, "", `${url.hostname} opened again`);
            document.getElementById("websiteExplorerStatus").textContent =
                `You already explored ${url.hostname}. It opened again, but this address earns no extra XP.`;
        });
        details.append(host, address);
        row.append(details, revisit);
        recentList.append(row);
    });
}

function recordWebsiteVisit(value, category, actionName) {
    const normalized = normalizeWebsiteUrl(value);
    if (normalized.error || !normalized.url) {
        return false;
    }
    const address = normalized.url.href;
    if (progress.visitedWebsiteUrls.includes(address)) {
        return false;
    }
    const previouslyUnlocked = new Set(unlockedAchievements().map((item) => item.id));
    const updated = {
        ...progress,
        websiteVisits: progress.websiteVisits + 1,
        visitedWebsiteUrls: [...progress.visitedWebsiteUrls, address],
        actionXp: progress.actionXp + 5,
    };
    const categoryCounter = siteVisitCounters[category];
    if (categoryCounter) {
        updated.siteLinksOpened += 1;
        updated[categoryCounter] += 1;
    }
    progress = updated;
    let saved = true;
    try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch (error) {
        console.error("Could not save SurfyFriend progress.", error);
        saved = false;
    }
    const newlyUnlocked = unlockedAchievements()
        .filter((item) => !previouslyUnlocked.has(item.id));
    const message = saved
        ? `+5 XP · ${actionName}${newlyUnlocked.length
            ? ` · Badge${newlyUnlocked.length === 1 ? "" : "s"} unlocked: ${newlyUnlocked.map((item) => item.title).join(", ")}! Claim them on Achievements.`
            : ""}`
        : "Website opened. Progress updated for now, but couldn't save it in this browser.";
    renderProgress(message);
    renderExplorerHistory();
    scheduleAccountSync();
    playUiSound(newlyUnlocked.length ? "achievement" : "success");
    return true;
}

document.getElementById("websiteExplorerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("websiteExplorerUrl");
    const status = document.getElementById("websiteExplorerStatus");
    const normalized = normalizeWebsiteUrl(input.value);
    if (normalized.error || !normalized.url) {
        status.textContent = normalized.error || "Enter a website address.";
        return;
    }
    const address = normalized.url.href;
    const known = progress.visitedWebsiteUrls.includes(address);
    const openedWindow = window.open(address, "_blank");
    if (!openedWindow) {
        status.textContent = "Your browser blocked the new tab. Allow pop-ups for SurfyFriend, then try again. No XP was awarded.";
        return;
    }
    openedWindow.opener = null;
    if (known) {
        status.textContent = `You already explored ${normalized.url.hostname}. It opened again, but this address earns no extra XP.`;
        return;
    }
    const earnedXp = recordWebsiteVisit(address, "", `${normalized.url.hostname} opened`);
    status.textContent = earnedXp
        ? `First visit to ${normalized.url.hostname}! +5 XP. Come back to SurfyFriend to see your progress.`
        : `You already explored ${normalized.url.hostname}. It opened again, but this address earns no extra XP.`;
    input.value = "";
});

function renderSuggestedSites() {
    const visibleSites = activeSiteFilter === "all"
        ? suggestedSites
        : suggestedSites.filter((site) => site.category === activeSiteFilter);
    renderSiteCards(visibleSites, document.getElementById("suggestedSiteGrid"));
    document.querySelectorAll("[data-site-filter]").forEach((button) => {
        const selected = button.dataset.siteFilter === activeSiteFilter;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
    });
}

document.querySelectorAll("[data-site-filter]").forEach((button) => {
    button.addEventListener("click", () => {
        activeSiteFilter = button.dataset.siteFilter;
        renderSuggestedSites();
    });
});

function loadPuterSdk() {
    if (window.puter?.ai?.chat) {
        return Promise.resolve(window.puter);
    }
    if (puterSdkPromise) {
        return puterSdkPromise;
    }

    puterSdkPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://js.puter.com/v2/";
        script.async = true;
        script.addEventListener("load", () => {
            if (window.puter?.ai?.chat) {
                resolve(window.puter);
            } else {
                reject(new Error("The Puter.js library did not initialize."));
            }
        }, { once: true });
        script.addEventListener("error", () => {
            reject(new Error("Could not load Puter.js. Check your internet connection."));
        }, { once: true });
        document.head.append(script);
    }).catch((error) => {
        puterSdkPromise = null;
        throw error;
    });
    return puterSdkPromise;
}

function puterOriginMessage() {
    return "Puter AI needs an http:// or https:// page origin. Run `python3 server.py` in the SurfyFriend folder and open `http://127.0.0.1:8765/`. Curated suggestions still work from this file.";
}

function puterResponseText(response) {
    const content = response?.message?.content;
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .filter((part) => part && typeof part.text === "string")
            .map((part) => part.text)
            .join("\n");
    }
    throw new Error("Puter returned a response in an unsupported format.");
}

function parsePuterSiteSuggestions(response, category) {
    const text = puterResponseText(response);
    const json = text.match(/\[[\s\S]*\]/)?.[0];
    if (!json) {
        throw new Error("Puter did not return a list of suggested websites.");
    }
    const suggestions = JSON.parse(json);
    if (!Array.isArray(suggestions)) {
        throw new Error("Puter's website suggestions were not a list.");
    }
    const selectedSites = [];
    const seenHosts = new Set();
    for (const suggestion of suggestions) {
        if (
            !suggestion ||
            typeof suggestion.name !== "string" ||
            typeof suggestion.url !== "string" ||
            typeof suggestion.description !== "string"
        ) {
            continue;
        }
        let url;
        try {
            url = new URL(suggestion.url);
        } catch {
            continue;
        }
        const host = url.hostname.toLowerCase().replace(/\.$/, "");
        const canonicalHost = host.replace(/^www\./, "");
        if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            (url.port && url.port !== "443") ||
            !host.includes(".") ||
            /^\d+(?:\.\d+){3}$/.test(host) ||
            seenHosts.has(canonicalHost)
        ) {
            continue;
        }
        const curatedSite = suggestedSites.find((site) => {
            const curatedHost = new URL(site.url).hostname
                .toLowerCase()
                .replace(/^www\./, "");
            return canonicalHost === curatedHost ||
                canonicalHost.endsWith(`.${curatedHost}`) ||
                curatedHost.endsWith(`.${canonicalHost}`);
        });
        if (curatedSite) {
            if (curatedSite.category !== category) {
                continue;
            }
            selectedSites.push(curatedSite);
        } else {
            const name = suggestion.name.trim().slice(0, 100);
            const description = suggestion.description.trim().slice(0, 240);
            if (!name || !description) {
                continue;
            }
            selectedSites.push({
                id: `puter-${host}`,
                category,
                name,
                url: url.origin,
                description,
                note: "AI-generated and not independently verified by SurfyFriend. Check the address, license, and download rules before using it.",
                aiSuggested: true,
            });
        }
        seenHosts.add(canonicalHost);
        if (selectedSites.length === 4) {
            break;
        }
    }
    return selectedSites;
}

document.getElementById("getPuterSuggestions").addEventListener("click", async () => {
    const category = document.getElementById("suggestionCategory").value;
    const button = document.getElementById("getPuterSuggestions");
    const status = document.getElementById("puterSuggestionStatus");
    const results = document.getElementById("puterSuggestionResults");
    const catalog = suggestedSites
        .filter((site) => site.category === category)
        .map(({ name, url, description }) => ({ name, url, description }));
    if (!siteCategories[category] || catalog.length === 0) {
        status.textContent = "Choose a category with available curated sources.";
        return;
    }
    if (!["http:", "https:"].includes(window.location.protocol)) {
        status.textContent = puterOriginMessage();
        return;
    }

    button.disabled = true;
    results.hidden = true;
    status.textContent = "Connecting to Puter AI. You may be asked to sign in.";
    try {
        const puter = await loadPuterSdk();
        const prompt = [
            "Recommend up to 4 genuinely useful, reputable websites for a beginner. You may include websites outside the provided curated catalog.",
            `Topic: ${siteCategories[category]}.`,
            "Do not claim to have searched or verified the web. Only include sites whose official HTTPS homepage you know with confidence; do not invent names or URLs.",
            "Prefer legal, official sources and respect account access and licensing. Return only a JSON array of objects with name, url, and a brief description, ordered from most to least useful.",
            `Curated catalog: ${JSON.stringify(catalog)}`,
        ].join("\n");
        const response = await puter.ai.chat(prompt, {
            normalize: true,
            max_tokens: 450,
        });
        const chosenSites = parsePuterSiteSuggestions(response, category);
        if (chosenSites.length === 0) {
            status.textContent =
                "Puter didn't return any usable HTTPS suggestions. Browse the curated list below.";
            return;
        }
        renderSiteCards(chosenSites, results);
        results.hidden = false;
        status.textContent = "Puter suggested these sources. Any outside the curated list are marked and haven't been verified.";
    } catch (error) {
        console.error("Could not get Puter website suggestions.", error);
        const detail = error instanceof Error ? ` ${error.message}` : "";
        const originProblem = /origin/i.test(detail);
        status.textContent = originProblem
            ? `${puterOriginMessage()} The curated list is still available below.`
            : `Puter suggestions couldn't be loaded.${detail} The curated list is still available below.`;
    } finally {
        button.disabled = false;
    }
});

function emptyProgress() {
    return {
        linksOpened: 0,
        queueItemsAdded: 0,
        queueLinksOpened: 0,
        batchAdds: 0,
        mediaPreviews: 0,
        imagePreviews: 0,
        audioPreviews: 0,
        videoPreviews: 0,
        filesUploaded: 0,
        actionXp: 0,
        pageScans: 0,
        pageLinksQueued: 0,
        cloudLinksOpened: 0,
        siteLinksOpened: 0,
        softwareSiteVisits: 0,
        mediaSiteVisits: 0,
        bookSiteVisits: 0,
        dataSiteVisits: 0,
        socialSiteVisits: 0,
        entertainmentSiteVisits: 0,
        gamesSiteVisits: 0,
        websiteVisits: 0,
        visitedWebsiteUrls: [],
        claimedAchievements: [],
    };
}

function readProgress() {
    try {
        const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "null");
        if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
            return emptyProgress();
        }
        const activity = emptyProgress();
        Object.keys(activity).forEach((key) => {
            const value = saved[key];
            if (key === "claimedAchievements" && Array.isArray(value)) {
                activity.claimedAchievements = value.filter((id) =>
                    typeof id === "string" &&
                    achievementDefinitions.some((achievement) => achievement.id === id)
                );
            } else if (key === "visitedWebsiteUrls" && Array.isArray(value)) {
                activity.visitedWebsiteUrls = [...new Set(value.filter((url) => {
                    if (typeof url !== "string") {
                        return false;
                    }
                    const normalized = normalizeWebsiteUrl(url);
                    return normalized.url?.href === url;
                }))];
            } else if (Number.isSafeInteger(value) && value >= 0) {
                activity[key] = value;
            }
        });
        activity.websiteVisits = activity.visitedWebsiteUrls.length;
        return activity;
    } catch (error) {
        console.error("Could not read SurfyFriend progress.", error);
        return emptyProgress();
    }
}

let progress = readProgress();

function unlockedAchievements(activity = progress) {
    return achievementDefinitions.filter((achievement) => achievement.requirement(activity));
}

function totalExperience(activity = progress) {
    return activity.actionXp + unlockedAchievements(activity)
        .reduce((bonus, achievement) => bonus + achievement.bonus, 0);
}

function createAchievementCard(achievement, earned) {
    const claimed = earned && progress.claimedAchievements.includes(achievement.id);
    const card = document.createElement("article");
    card.className = `achievement-card${earned ? " unlocked" : " locked"}`;
    card.setAttribute(
        "aria-label",
        `${achievement.title}: ${claimed ? "claimed" : earned ? "unlocked" : achievement.progress(progress)}`
    );
    const icon = document.createElement("span");
    icon.className = "achievement-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = earned ? achievement.icon : "·";
    const details = document.createElement("div");
    details.className = "achievement-details";
    const title = document.createElement("strong");
    title.textContent = achievement.title;
    const description = document.createElement("span");
    description.textContent = earned ? achievement.description : achievement.progress(progress);
    details.append(title, description);
    const reward = document.createElement("span");
    reward.className = "achievement-reward";
    reward.textContent = earned ? `+${achievement.bonus} XP` : "LOCKED";
    card.append(icon, details, reward);
    if (earned && !claimed) {
        const claimButton = document.createElement("button");
        claimButton.type = "button";
        claimButton.className = "achievement-claim";
        claimButton.dataset.claimAchievement = achievement.id;
        claimButton.textContent = "Claim";
        claimButton.setAttribute("aria-label", `Claim ${achievement.title} badge`);
        card.append(claimButton);
    } else if (claimed) {
        const claimedLabel = document.createElement("span");
        claimedLabel.className = "achievement-claimed";
        claimedLabel.textContent = "✓ Claimed";
        card.append(claimedLabel);
    }
    return card;
}

function renderProgress(message = "") {
    const xp = totalExperience();
    const unlocked = unlockedAchievements();
    const currentLevelIndex = progressLevels.reduce((levelIndex, level, index) =>
        xp >= level.minimumXp ? index : levelIndex, 0);
    const currentLevel = progressLevels[currentLevelIndex];
    const nextLevel = progressLevels[currentLevelIndex + 1];
    const currentLevelXp = xp - currentLevel.minimumXp;
    const nextLevelSpan = nextLevel
        ? nextLevel.minimumXp - currentLevel.minimumXp
        : 1;
    const levelPercent = nextLevel
        ? Math.min(100, Math.round((currentLevelXp / nextLevelSpan) * 100))
        : 100;

    document.getElementById("xpTotal").textContent = String(xp);
    document.getElementById("levelName").textContent = currentLevel.name;
    document.getElementById("levelNext").textContent = nextLevel
        ? `${xp} / ${nextLevel.minimumXp} XP`
        : "Top level reached";
    const levelProgress = document.getElementById("levelProgress");
    levelProgress.value = levelPercent;
    levelProgress.setAttribute(
        "aria-label",
        nextLevel ? `Progress to ${nextLevel.name}` : "Top level reached"
    );
    document.getElementById("progressCaption").textContent = nextLevel
        ? `${nextLevel.minimumXp - xp} XP to ${nextLevel.name}. Earn points by opening links, exploring new websites, queueing downloads, previewing media, and saving files.`
        : "You’ve reached the top level. Keep exploring at your own pace.";
    document.getElementById("achievementSummary").textContent =
        `${unlocked.length} of ${achievementDefinitions.length} unlocked`;
    const unclaimedCount = unlocked.filter((achievement) =>
        !progress.claimedAchievements.includes(achievement.id)
    ).length;
    const achievementCount = document.getElementById("achievementCount");
    achievementCount.textContent = String(unclaimedCount);
    achievementCount.hidden = unclaimedCount === 0;
    document.getElementById("achievementPageSummary").textContent =
        `${unlocked.length} of ${achievementDefinitions.length} badges unlocked`;
    document.getElementById("achievementPageLevel").textContent =
        `${currentLevel.name} · ${xp} XP`;
    document.getElementById("allAchievementCount").textContent = String(achievementDefinitions.length);
    document.getElementById("unlockedAchievementCount").textContent = String(unlocked.length);
    document.getElementById("lockedAchievementCount").textContent =
        String(achievementDefinitions.length - unlocked.length);

    const featuredAchievement = document.getElementById("featuredAchievement");
    featuredAchievement.replaceChildren();
    const featured = achievementDefinitions.find((achievement) => !achievement.requirement(progress))
        || achievementDefinitions[achievementDefinitions.length - 1];
    featuredAchievement.append(
        createAchievementCard(featured, featured.requirement(progress))
    );

    const allGrid = document.getElementById("allAchievementsGrid");
    allGrid.replaceChildren();
    achievementDefinitions
        .filter((achievement) => {
            const earned = achievement.requirement(progress);
            return activeAchievementFilter === "all" ||
                (activeAchievementFilter === "unlocked" && earned) ||
                (activeAchievementFilter === "locked" && !earned);
        })
        .forEach((achievement) => {
            allGrid.append(createAchievementCard(achievement, achievement.requirement(progress)));
        });

    document.querySelectorAll("[data-achievement-filter]").forEach((button) => {
        const selected = button.dataset.achievementFilter === activeAchievementFilter;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
    });

    document.getElementById("progressStatus").textContent = message;
}

function showConfetti() {
    const burst = document.createElement("div");
    const colors = ["#7257e8", "#efae48", "#40ad8a", "#e66c8b", "#55a8d8"];
    burst.className = "confetti-burst";
    burst.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 44; index += 1) {
        const piece = document.createElement("span");
        piece.className = "confetti-piece";
        piece.style.setProperty("--start-x", `${Math.random() * 100}%`);
        piece.style.setProperty("--drift", `${Math.round(Math.random() * 320 - 160)}px`);
        piece.style.setProperty("--rotation", `${Math.round(Math.random() * 900 - 450)}deg`);
        piece.style.setProperty("--delay", `${Math.random() * 0.35}s`);
        piece.style.setProperty("--piece-color", colors[index % colors.length]);
        burst.append(piece);
    }
    document.body.append(burst);
    window.setTimeout(() => burst.remove(), 2600);
}

function claimAchievement(id) {
    const achievement = achievementDefinitions.find((item) =>
        item.id === id && item.requirement(progress)
    );
    if (!achievement || progress.claimedAchievements.includes(id)) {
        return;
    }

    const updatedProgress = {
        ...progress,
        claimedAchievements: [...progress.claimedAchievements, id],
    };
    try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(updatedProgress));
    } catch (error) {
        console.error("Could not save SurfyFriend progress.", error);
        document.getElementById("progressStatus").textContent =
            "Badge not claimed. Check your browser storage settings and try again.";
        return;
    }

    progress = updatedProgress;
    renderProgress(`Badge claimed: ${achievement.title}!`);
    showConfetti();
    scheduleAccountSync();
    playUiSound("achievement");
}

document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
        return;
    }
    const claimButton = event.target.closest("[data-claim-achievement]");
    if (claimButton instanceof HTMLButtonElement) {
        claimAchievement(claimButton.dataset.claimAchievement);
    }
});

document.querySelectorAll("[data-achievement-filter]").forEach((button) => {
    button.addEventListener("click", () => {
        activeAchievementFilter = button.dataset.achievementFilter;
        renderProgress();
    });
});

function recordProgress(counter, count, pointsEach, actionName, extraCounters = {}) {
    if (count <= 0) {
        return;
    }
    const previouslyUnlocked = new Set(unlockedAchievements().map((item) => item.id));
    const updated = {
        ...progress,
        [counter]: progress[counter] + count,
        actionXp: progress.actionXp + (count * pointsEach),
    };
    Object.entries(extraCounters).forEach(([key, value]) => {
        updated[key] = progress[key] + value;
    });
    progress = updated;
    let saved = true;
    try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch (error) {
        console.error("Could not save SurfyFriend progress.", error);
        saved = false;
    }
    const newlyUnlocked = unlockedAchievements()
        .filter((item) => !previouslyUnlocked.has(item.id));
    const message = saved
        ? `+${count * pointsEach} XP · ${actionName}${newlyUnlocked.length
            ? ` · Badge${newlyUnlocked.length === 1 ? "" : "s"} unlocked: ${newlyUnlocked.map((item) => item.title).join(", ")}! Claim them on Achievements.`
            : ""}`
        : "Progress updated for now, but couldn't save it in this browser.";
    renderProgress(message);
    scheduleAccountSync();
    playUiSound(newlyUnlocked.length ? "achievement" : "success");
}

function readHistory() {
    try {
        const savedHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
        return Array.isArray(savedHistory)
            ? savedHistory.filter((item) =>
                item &&
                typeof item.url === "string" &&
                typeof item.name === "string" &&
                typeof item.date === "string"
            )
            : [];
    } catch (error) {
        console.error("Could not read download history.", error);
        return [];
    }
}

let downloadHistory = readHistory();
let downloadQueue = readQueue();

function readQueue() {
    try {
        const savedQueue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
        return Array.isArray(savedQueue)
            ? savedQueue.filter((item) => {
                if (!item ||
                    typeof item.id !== "string" ||
                    typeof item.url !== "string" ||
                    typeof item.name !== "string" ||
                    typeof item.addedAt !== "string"
                ) {
                    return false;
                }
                try {
                    const url = new URL(item.url);
                    return ["http:", "https:"].includes(url.protocol) && !isYouTubeUrl(url);
                } catch {
                    return false;
                }
            }).slice(0, queueLimit)
            : [];
    } catch (error) {
        console.error("Could not read download queue.", error);
        return [];
    }
}

function saveQueue() {
    try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(downloadQueue));
        scheduleAccountSync();
        return true;
    } catch (error) {
        console.error("Could not save download queue.", error);
        return false;
    }
}

function saveHistory() {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(downloadHistory));
        scheduleAccountSync();
        return true;
    } catch (error) {
        console.error("Could not save download history.", error);
        return false;
    }
}

function serializeAccountData() {
    return {
        progress,
        queue: downloadQueue,
        history: downloadHistory,
    };
}

function accountDataHasActivity(data) {
    if (!data || typeof data !== "object") {
        return false;
    }
    const savedProgress = data.progress;
    return (savedProgress && typeof savedProgress === "object" &&
        (
            Object.values(savedProgress).some((value) => Number.isSafeInteger(value) && value > 0) ||
            savedProgress.claimedAchievements?.length > 0 ||
            savedProgress.visitedWebsiteUrls?.length > 0
        )) ||
        data.queue?.length > 0 ||
        data.history?.length > 0;
}

function updateAccountPanel() {
    const form = document.getElementById("accountSignInForm");
    const signedIn = document.getElementById("accountSignedIn");
    const toolbarForm = document.getElementById("toolbarAccountForm");
    const toolbarSignedIn = document.getElementById("toolbarAccountSignedIn");
    const hasAccountFeatureAccess = Boolean(accountUsername) && fullVersionAvailable;
    signedIn.hidden = !accountUsername;
    form.hidden = Boolean(accountUsername) || form.dataset.disabled === "true";
    document.getElementById("accountSignedInName").textContent = accountUsername;
    toolbarSignedIn.hidden = !accountUsername;
    toolbarForm.hidden = Boolean(accountUsername) || toolbarForm.dataset.disabled === "true";
    document.getElementById("toolbarAccountSignedInName").textContent = accountUsername;
    toolbarAccountButton.querySelector("span").textContent = accountUsername || "Sign in";
    toolbarAccountButton.setAttribute(
        "aria-label",
        accountUsername ? `Account: ${accountUsername}` : "Sign in to SurfyFriend"
    );
    toolbarAccountButton.title = accountUsername ? `Signed in as ${accountUsername}` : "Sign in to SurfyFriend";
    document.querySelectorAll("[data-account-required-content]").forEach((content) => {
        content.hidden = !hasAccountFeatureAccess;
    });
    document.querySelectorAll("[data-account-required-notice]").forEach((notice) => {
        notice.hidden = hasAccountFeatureAccess;
    });
    document.getElementById("helperCard").hidden = !hasAccountFeatureAccess;
    toolbarSearch.disabled = !hasAccountFeatureAccess;
    toolbarSearch.title = hasAccountFeatureAccess
        ? "Search your download history"
        : "Sign in to search download history";
    document.querySelectorAll("[data-account-lock]").forEach((badge) => {
        badge.hidden = hasAccountFeatureAccess || !fullVersionAvailable;
    });
}

function setAccountStatus(message) {
    document.getElementById("accountStatus").textContent = message;
    document.getElementById("toolbarAccountStatus").textContent = message;
}

function setAccountFormsDisabled(disabled) {
    [
        document.getElementById("accountSignInForm"),
        document.getElementById("toolbarAccountForm"),
    ].forEach((form) => {
        form.dataset.disabled = String(disabled);
        form.querySelectorAll("button").forEach((button) => { button.disabled = disabled; });
    });
    updateAccountPanel();
}

async function accountApiRequest(path, method = "GET", data) {
    const options = {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
    };
    if (data !== undefined) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(data);
    }
    const response = await fetch(path, options);
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) {
        throw new Error("The SurfyFriend account service is not available at this address.");
    }
    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.error || `Account request failed (HTTP ${response.status}).`);
    }
    return payload;
}

function storeAccountData(data) {
    if (
        !data ||
        typeof data !== "object" ||
        !data.progress ||
        typeof data.progress !== "object" ||
        !Array.isArray(data.queue) ||
        !Array.isArray(data.history)
    ) {
        throw new Error("The account returned data in an unsupported format.");
    }
    const previousValues = [
        localStorage.getItem(PROGRESS_KEY),
        localStorage.getItem(QUEUE_KEY),
        localStorage.getItem(HISTORY_KEY),
    ];
    try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(data.progress));
        localStorage.setItem(QUEUE_KEY, JSON.stringify(data.queue));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(data.history));
    } catch (error) {
        console.error("Could not store account data in this browser.", error);
        try {
            [PROGRESS_KEY, QUEUE_KEY, HISTORY_KEY].forEach((key, index) => {
                const previous = previousValues[index];
                if (previous === null) {
                    localStorage.removeItem(key);
                } else {
                    localStorage.setItem(key, previous);
                }
            });
        } catch (restoreError) {
            console.error("Could not restore local data after an account sync error.", restoreError);
        }
        throw new Error("Account data could not be saved in this browser. Check local storage settings.");
    }
    progress = readProgress();
    downloadQueue = readQueue();
    downloadHistory = readHistory();
    renderProgress("Account data loaded on this device.");
    renderQueue();
    renderHistory();
    renderExplorerHistory();
}

async function writeCurrentDeviceToAccount() {
    await accountApiRequest("/api/account/data", "PUT", serializeAccountData());
}

async function waitForAccountSync() {
    if (accountSyncTimer) {
        window.clearTimeout(accountSyncTimer);
        accountSyncTimer = null;
    }
    await accountSyncChain;
}

function scheduleAccountSync() {
    if (!accountUsername || !accountSyncEnabled) {
        return;
    }
    if (accountSyncTimer) {
        window.clearTimeout(accountSyncTimer);
    }
    accountSyncTimer = window.setTimeout(() => {
        accountSyncTimer = null;
        accountSyncChain = accountSyncChain
            .then(async () => {
                if (accountUsername && accountSyncEnabled) {
                    await writeCurrentDeviceToAccount();
                }
            })
            .catch((error) => {
                console.error("Could not sync SurfyFriend account data.", error);
                setAccountStatus(`This device is saved locally, but account sync failed. ${error.message}`);
            });
    }, 450);
}

async function loadAccountDataOnThisDevice(requireConfirmation = true) {
    await waitForAccountSync();
    const response = await accountApiRequest("/api/account/data");
    const localData = serializeAccountData();
    if (
        requireConfirmation &&
        accountDataHasActivity(localData) &&
        !window.confirm("Load the account's XP, achievements, queue, and download history on this device? This replaces those saved items in this browser.")
    ) {
        accountSyncEnabled = false;
        setAccountStatus("Nothing was replaced. Choose “Save this device to account” or load the account data when ready.");
        return false;
    }
    storeAccountData(response.data);
    accountSyncEnabled = true;
    setAccountStatus("Account data loaded. Changes on this device now sync automatically.");
    return true;
}

async function initializeAccountService() {
    if (!["http:", "https:"].includes(window.location.protocol)) {
        setAccountFormsDisabled(true);
        setAccountStatus("Accounts require the SurfyFriend Python backend and an HTTP(S) page. Start python3 server.py and reload.");
        return;
    }
    try {
        const service = await accountApiRequest("/api/account/status");
        if (!service.enabled) {
            setAccountFormsDisabled(true);
            setAccountStatus("Password accounts are disabled on unencrypted LAN connections. Use HTTPS for account sign-in.");
            return;
        }
        if (!service.authenticated || typeof service.username !== "string") {
            updateAccountPanel();
            setAccountStatus("Optional account sync is ready. Sign in or create an account.");
            return;
        }
        accountUsername = service.username;
        updateAccountPanel();
        const account = await accountApiRequest("/api/account/data");
        const localData = serializeAccountData();
        if (!accountDataHasActivity(account.data) && accountDataHasActivity(localData)) {
            await writeCurrentDeviceToAccount();
            accountSyncEnabled = true;
            setAccountStatus("Signed in. This device's saved data has been added to your account.");
        } else if (!accountDataHasActivity(localData)) {
            storeAccountData(account.data);
            accountSyncEnabled = true;
            setAccountStatus("Signed in. Account data loaded; changes on this device now sync automatically.");
        } else {
            setAccountStatus("Signed in. Choose whether to load account data or save this device's data to the account.");
        }
    } catch (error) {
        console.error("Could not initialize the SurfyFriend account service.", error);
        setAccountFormsDisabled(true);
        setAccountStatus(`${error.message} Run the SurfyFriend Python backend or use its hosted HTTPS address.`);
    }
}

async function submitAccountForm(form, action) {
    const usernameInput = form.querySelector('input[name="username"]');
    const passwordInput = form.querySelector('input[name="password"]');
    const buttons = form.querySelectorAll("button");
    passwordInput.autocomplete = action === "register" ? "new-password" : "current-password";
    buttons.forEach((button) => { button.disabled = true; });
    setAccountStatus(action === "register" ? "Creating your account…" : "Signing in…");
    try {
        const data = {
            username: usernameInput.value.trim(),
            password: passwordInput.value,
        };
        if (action === "register") {
            data.data = serializeAccountData();
        }
        const response = await accountApiRequest(
            action === "register" ? "/api/account/register" : "/api/account/login",
            "POST",
            data
        );
        accountUsername = response.username;
        updateAccountPanel();
        if (action === "register") {
            accountSyncEnabled = true;
            setAccountStatus("Account created. This device's XP, achievements, queue, and history were saved to it.");
            playUiSound("success");
        } else {
            accountSyncEnabled = false;
            const account = await accountApiRequest("/api/account/data");
            const localData = serializeAccountData();
            if (!accountDataHasActivity(account.data) && accountDataHasActivity(localData)) {
                await writeCurrentDeviceToAccount();
                accountSyncEnabled = true;
                setAccountStatus("Signed in. This device's saved data has been added to your account.");
            } else if (!accountDataHasActivity(localData)) {
                storeAccountData(account.data);
                accountSyncEnabled = true;
                setAccountStatus("Signed in. Account data loaded; changes on this device now sync automatically.");
            } else {
                setAccountStatus("Signed in. Choose whether to load account data or save this device's data to the account.");
            }
        }
    } catch (error) {
        console.error("Could not sign in to SurfyFriend account.", error);
        setAccountStatus(error.message);
    } finally {
        passwordInput.value = "";
        buttons.forEach((button) => { button.disabled = form.dataset.disabled === "true"; });
    }
}

[
    document.getElementById("accountSignInForm"),
    document.getElementById("toolbarAccountForm"),
].forEach((form) => {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitter = event.submitter;
        const action = submitter instanceof HTMLButtonElement
            ? submitter.dataset.accountAction
            : "login";
        await submitAccountForm(form, action);
    });
});

document.getElementById("syncAccountData").addEventListener("click", async () => {
    const button = document.getElementById("syncAccountData");
    button.disabled = true;
    try {
        await loadAccountDataOnThisDevice(true);
    } catch (error) {
        console.error("Could not load SurfyFriend account data.", error);
        setAccountStatus(error.message);
    } finally {
        button.disabled = false;
    }
});

document.getElementById("uploadLocalAccountData").addEventListener("click", async () => {
    if (!window.confirm("Save this device's XP, achievements, queue, and download history to the account? This replaces the account's saved copy.")) {
        return;
    }
    const button = document.getElementById("uploadLocalAccountData");
    button.disabled = true;
    try {
        await waitForAccountSync();
        await writeCurrentDeviceToAccount();
        accountSyncEnabled = true;
        setAccountStatus("This device's data is now saved to the account; future changes sync automatically.");
    } catch (error) {
        console.error("Could not save this device's SurfyFriend data to the account.", error);
        setAccountStatus(error.message);
    } finally {
        button.disabled = false;
    }
});

document.getElementById("accountSignOut").addEventListener("click", async () => {
    const button = document.getElementById("accountSignOut");
    button.disabled = true;
    await waitForAccountSync();
    let finalSyncFailed = false;
    if (accountUsername && accountSyncEnabled) {
        await writeCurrentDeviceToAccount().catch((error) => {
            console.error("Could not sync account before signing out.", error);
            finalSyncFailed = true;
        });
    }
    try {
        await accountApiRequest("/api/account/logout", "POST", {});
        accountUsername = "";
        accountSyncEnabled = false;
        updateAccountPanel();
        setAccountStatus(finalSyncFailed
            ? "Signed out. This browser's data remains saved here, but the last changes could not be synced."
            : "Signed out. This browser's saved data remains here.");
    } catch (error) {
        console.error("Could not sign out of SurfyFriend account.", error);
        setAccountStatus(error.message);
    } finally {
        button.disabled = false;
    }
});

function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    overlay.setAttribute("aria-hidden", "true");
}

menuToggle.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    overlay.classList.toggle("open", isOpen);
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    overlay.setAttribute("aria-hidden", String(!isOpen));
});

overlay.addEventListener("click", closeSidebar);

function showPage(page, updateHash = true, trackHistory = true) {
    const pageName = pageDetails[page] ? page : "home";
    if (
        fullVersionStatusKnown &&
        !fullVersionAvailable &&
        !["home", "downloader", "settings"].includes(pageName)
    ) {
        if (window.location.hash !== "#home") {
            window.location.hash = "home";
        }
        showPage("home", false, false);
        return;
    }
    if (pageName !== currentPageName) {
        if (updateHash && trackHistory) {
            pageNavigationHistory.push(currentPageName);
        }
        currentPageName = pageName;
        if (trackHistory) {
            playUiSound("click");
        }
    }
    document.querySelectorAll("[data-section]").forEach((section) => {
        section.hidden = section.dataset.section !== pageName;
    });
    document.querySelectorAll(".sidebar [data-page]").forEach((link) => {
        const isCurrent = link.dataset.page === pageName;
        link.classList.toggle("active", isCurrent);
        if (isCurrent) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    });
    pageTitle.textContent = pageDetails[pageName].title;
    pageEyebrow.textContent = pageDetails[pageName].eyebrow;
    closeSidebar();

    if (updateHash && window.location.hash !== `#${pageName}`) {
        window.location.hash = pageName;
    }
    if (pageName === "history") {
        renderHistory();
    }
    if (pageName === "queue") {
        renderQueue();
    }
    if (pageName === "uploads") {
        loadUploadedFiles();
    }
    if (pageName === "downloader") {
        urlInput.focus();
    }
    if (pageName === "media") {
        mediaUrlInput.focus();
    }
    if (pageName === "explorer") {
        renderExplorerHistory();
        document.getElementById("websiteExplorerUrl").focus();
    }
    if (pageName === "checker") {
        document.getElementById("websiteCheckerUrl").focus();
    }
}

function isTextEntry(target) {
    return target instanceof Element &&
        Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function goBackWithinDltime() {
    if (sidebar.classList.contains("open")) {
        closeSidebar();
        return;
    }
    const previousPage = pageNavigationHistory.pop();
    showPage(previousPage || "home", true, false);
}

const shortcutPages = {
    "1": "home",
    "2": "downloader",
    "3": "sites",
    "4": "explorer",
    "5": "media",
    "6": "queue",
    "7": "uploads",
    "8": "helper",
    "9": "achievements",
    "0": "settings",
};

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !toolbarToolsMenu.hidden) {
        event.preventDefault();
        closeToolbarTools();
        return;
    }
    if (isTextEntry(event.target) || event.repeat) {
        return;
    }
    if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        Object.hasOwn(shortcutPages, event.key)
    ) {
        event.preventDefault();
        showPage(shortcutPages[event.key]);
        return;
    }
    if (event.key === "Escape") {
        event.preventDefault();
        goBackWithinDltime();
    }
});

function visibleGamepadControls() {
    return Array.from(document.querySelectorAll(
        "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
    )).filter((element) => {
        if (!(element instanceof HTMLElement) || element.closest("[hidden], [aria-hidden='true']")) {
            return false;
        }
        const rect = element.getBoundingClientRect();
        return element.getClientRects().length > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth;
    });
}

function focusNextGamepadControl(direction) {
    const controls = visibleGamepadControls();
    if (controls.length === 0) {
        return;
    }
    const currentIndex = controls.indexOf(document.activeElement);
    const forward = direction === "down" || direction === "right";
    const nextIndex = currentIndex < 0
        ? (forward ? 0 : controls.length - 1)
        : (currentIndex + (forward ? 1 : -1) + controls.length) % controls.length;
    controls[nextIndex].focus();
}

function gamepadButtonPressed(gamepad, index) {
    return Boolean(gamepad.buttons[index]?.pressed);
}

function pollGamepad() {
    const pads = navigator.getGamepads?.();
    if (!pads) {
        gamepadFrame = 0;
        return;
    }
    let gamepad = activeGamepadIndex === null ? null : pads[activeGamepadIndex];
    if (!gamepad?.connected) {
        gamepad = Array.from(pads).find((pad) => pad?.connected) || null;
        activeGamepadIndex = gamepad?.index ?? null;
        previousGamepadButtons = [];
    }
    if (!gamepad) {
        gamepadFrame = 0;
        return;
    }

    const axisX = gamepad.axes[0] || 0;
    const axisY = gamepad.axes[1] || 0;
    const direction = gamepadButtonPressed(gamepad, 12) ? "up"
        : gamepadButtonPressed(gamepad, 13) ? "down"
            : gamepadButtonPressed(gamepad, 14) ? "left"
                : gamepadButtonPressed(gamepad, 15) ? "right"
                    : axisY < -0.6 ? "up"
                        : axisY > 0.6 ? "down"
                            : axisX < -0.6 ? "left"
                                : axisX > 0.6 ? "right" : "";
    const now = performance.now();
    if (direction && now - lastGamepadDirectionAt > 210) {
        focusNextGamepadControl(direction);
        lastGamepadDirectionAt = now;
    }

    const buttonA = gamepadButtonPressed(gamepad, 0);
    const buttonB = gamepadButtonPressed(gamepad, 1);
    const buttonStart = gamepadButtonPressed(gamepad, 9);
    if (buttonA && !previousGamepadButtons[0]) {
        const active = document.activeElement;
        if (active instanceof HTMLElement) {
            playUiSound("click");
            active.click();
        } else {
            visibleGamepadControls()[0]?.focus();
        }
    }
    if (buttonB && !previousGamepadButtons[1]) {
        goBackWithinDltime();
    }
    if (buttonStart && !previousGamepadButtons[9]) {
        menuToggle.click();
    }
    previousGamepadButtons = gamepad.buttons.map((button) => button.pressed);
    gamepadFrame = window.requestAnimationFrame(pollGamepad);
}

function startGamepadPolling(gamepad) {
    activeGamepadIndex = gamepad.index;
    previousGamepadButtons = [];
    document.getElementById("gamepadStatus").textContent =
        `${gamepad.id || "Gamepad"} connected. D-pad or left stick moves focus; A/0 activates; B/1 goes back.`;
    if (!gamepadFrame) {
        gamepadFrame = window.requestAnimationFrame(pollGamepad);
    }
}

window.addEventListener("gamepadconnected", (event) => {
    startGamepadPolling(event.gamepad);
});
window.addEventListener("gamepaddisconnected", (event) => {
    if (activeGamepadIndex === event.gamepad.index) {
        activeGamepadIndex = null;
        previousGamepadButtons = [];
        if (gamepadFrame) {
            window.cancelAnimationFrame(gamepadFrame);
            gamepadFrame = 0;
        }
        document.getElementById("gamepadStatus").textContent =
            "Gamepad disconnected. Connect another controller to use gamepad navigation.";
        const remaining = Array.from(navigator.getGamepads?.() || [])
            .find((gamepad) => gamepad?.connected);
        if (remaining) {
            startGamepadPolling(remaining);
        }
    }
});

document.querySelectorAll(".sidebar [data-page]").forEach((link) => {
    link.addEventListener("click", (event) => {
        event.preventDefault();
        showPage(link.dataset.page);
        if (link.dataset.focus) {
            const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
            document.getElementById(link.dataset.focus)?.scrollIntoView({ behavior, block: "center" });
        }
    });
});

document.querySelectorAll(".achievement-heading [data-focus]").forEach((button) => {
    button.addEventListener("click", () => {
        const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
        document.getElementById(button.dataset.focus)?.scrollIntoView({ behavior, block: "center" });
    });
});

document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.go));
});

window.addEventListener("hashchange", () => {
    showPage(window.location.hash.slice(1), false, false);
});

function safeFilename(value) {
    return value.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\.+$/, "");
}

function filenameFromUrl(parsedUrl) {
    const lastPart = parsedUrl.pathname.split("/").filter(Boolean).pop();
    if (!lastPart) {
        return "download";
    }
    try {
        return decodeURIComponent(lastPart);
    } catch {
        return lastPart;
    }
}

function cloudShareProvider(parsedUrl) {
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname;
    if (
        hostname === "drive.google.com" &&
        (
            /^\/file\/d\/[^/]+/.test(pathname) ||
            (["/open", "/uc"].includes(pathname) && parsedUrl.searchParams.has("id"))
        )
    ) {
        return "Google Drive";
    }
    if (
        ["dropbox.com", "www.dropbox.com"].includes(hostname) &&
        /^\/(?:s\/|sh\/|scl\/fi\/)[^/]+/.test(pathname)
    ) {
        return "Dropbox";
    }
    if (
        (hostname === "1drv.ms" && pathname.length > 1) ||
        (
            ["onedrive.live.com", "www.onedrive.live.com"].includes(hostname) &&
            (
                pathname === "/redir" ||
                parsedUrl.searchParams.has("resid") ||
                parsedUrl.searchParams.has("id")
            )
        )
    ) {
        return "OneDrive";
    }
    return "";
}

function suggestedFilename(parsedUrl, provider = cloudShareProvider(parsedUrl)) {
    return provider
        ? `${provider} shared file`
        : filenameFromUrl(parsedUrl);
}

function mayBeHtmlPage(parsedUrl) {
    const extension = parsedUrl.pathname.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase();
    if (!extension || ["htm", "html", "xhtml"].includes(extension)) {
        return true;
    }
    return !new Set([
        "7z", "aac", "apk", "avi", "avif", "bmp", "bz2", "css", "csv",
        "deb", "dmg", "doc", "docx", "epub", "exe", "flac", "gif", "gz",
        "ico", "iso", "jpeg", "jpg", "js", "json", "m4a", "m4v", "mkv",
        "mov", "mp3", "mp4", "msi", "odt", "ogg", "pdf", "png", "ppt",
        "pptx", "rar", "rpm", "svg", "tar", "txt", "wav", "webm", "webp",
        "xls", "xlsx", "xml", "xz", "zip",
    ]).has(extension);
}

function isYouTubeUrl(parsedUrl) {
    const hostname = parsedUrl.hostname.toLowerCase();
    return ["youtu.be", "youtube.com", "youtube-nocookie.com", "yt.be"].some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
}

function renderHistory() {
    const query = toolbarSearch.value.trim().toLowerCase();
    const filteredHistory = downloadHistory.filter((item) =>
        `${item.name} ${item.url}`.toLowerCase().includes(query)
    );

    historyList.replaceChildren();
    filteredHistory.forEach((item) => {
        const row = document.createElement("article");
        row.className = "history-item";

        const icon = document.createElement("span");
        icon.className = "history-file-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "↧";

        const details = document.createElement("div");
        details.className = "history-details";
        const name = document.createElement("strong");
        name.textContent = item.name;
        const link = document.createElement("span");
        link.className = "history-url";
        link.textContent = item.url;
        const date = document.createElement("span");
        date.className = "history-date";
        date.textContent = new Date(item.date).toLocaleString();
        details.append(name, link, date);

        const reopen = document.createElement("button");
        reopen.type = "button";
        reopen.className = "history-open";
        reopen.textContent = "Open link ↗";
        reopen.setAttribute("aria-label", `Open ${item.name}`);
        reopen.addEventListener("click", () => {
            urlInput.value = item.url;
            filenameInput.value = item.name;
            status.textContent = "";
            updateLinkHint();
            showPage("downloader");
        });

        row.append(icon, details, reopen);
        historyList.append(row);
    });

    historyEmpty.hidden = downloadHistory.length > 0;
    historyNoResults.hidden = downloadHistory.length === 0 || filteredHistory.length > 0;
    document.getElementById("historyCount").textContent = String(downloadHistory.length);
    document.getElementById("totalDownloads").textContent = String(downloadHistory.length);
    document.getElementById("lastDownload").textContent = downloadHistory[0]
        ? new Date(downloadHistory[0].date).toLocaleDateString()
        : "—";
}

function validateDirectFileUrl(rawUrl) {
    let parsedUrl;
    try {
        parsedUrl = new URL(rawUrl.trim());
    } catch {
        return { error: "Enter a valid file link or supported cloud share URL." };
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return { error: "Only HTTP and HTTPS links are supported." };
    }
    if (isYouTubeUrl(parsedUrl)) {
        return { error: "YouTube pages aren't direct file links and can't be added to this queue." };
    }
    return { parsedUrl, provider: cloudShareProvider(parsedUrl) };
}

function updateLinkHint() {
    const hint = document.getElementById("linkHint");
    const rawUrl = urlInput.value.trim();
    const clearUrl = document.getElementById("clearUrl");
    clearUrl.hidden = rawUrl.length === 0;

    if (!rawUrl) {
        hint.textContent = "Paste a direct file URL or a supported Google Drive, Dropbox, or OneDrive share.";
        hint.classList.remove("link-hint-warning");
        return;
    }

    const validation = validateDirectFileUrl(rawUrl);
    if (validation.error) {
        hint.textContent = validation.error.includes("YouTube")
            ? "This is a YouTube page, not a direct file link. Use the service's official download options where available."
            : validation.error.includes("HTTP")
                ? validation.error
                : "Include the full web address, starting with https:// or http://.";
        hint.classList.add("link-hint-warning");
        return;
    }

    const parsedUrl = validation.parsedUrl;
    if (validation.provider) {
        hint.textContent = `${validation.provider} share recognized. It may open a preview; use the provider's Download option if shown.`;
        hint.classList.remove("link-hint-warning");
        return;
    }
    const requestedName = safeFilename(filenameInput.value);
    const suggestedName = requestedName || suggestedFilename(parsedUrl);
    const pathLooksLikeAFile = /\.[a-z0-9]{2,8}$/i.test(parsedUrl.pathname);
    hint.textContent = pathLooksLikeAFile && !mayBeHtmlPage(parsedUrl)
        ? `Link format looks okay for ${parsedUrl.hostname}. Suggested name: ${suggestedName}. We can't confirm access until you open it.`
        : `This may be a webpage. SurfyFriend will download its HTML when possible; linked images and files are not included.`;
    hint.classList.remove("link-hint-warning");
}

urlInput.addEventListener("input", updateLinkHint);
filenameInput.addEventListener("input", updateLinkHint);

document.getElementById("clearUrl").addEventListener("click", () => {
    urlInput.value = "";
    status.textContent = "";
    updateLinkHint();
    urlInput.focus();
});

function inferMediaType(fileName, mimeType = "") {
    const normalizedMime = mimeType.toLowerCase().split(";")[0].trim();
    if (normalizedMime.startsWith("video/")) {
        return "video";
    }
    if (normalizedMime.startsWith("audio/")) {
        return "audio";
    }
    if (normalizedMime.startsWith("image/")) {
        return "image";
    }

    const extension = fileName.toLowerCase().split(".").pop();
    const mediaTypes = {
        video: ["3gp", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm"],
        audio: ["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba"],
        image: ["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"],
    };
    return Object.entries(mediaTypes).find(([, extensions]) => extensions.includes(extension))?.[0] || null;
}

function clearMediaPreview() {
    mediaLoadVersion += 1;
    if (activeMediaObjectUrl) {
        URL.revokeObjectURL(activeMediaObjectUrl);
        activeMediaObjectUrl = null;
    }
    const previousPreview = mediaPlayer.querySelector("video, audio, img");
    if (previousPreview) {
        if (previousPreview instanceof HTMLMediaElement) {
            previousPreview.pause();
            previousPreview.removeAttribute("src");
            previousPreview.load();
        } else {
            previousPreview.removeAttribute("src");
        }
    }
    mediaPlayer.replaceChildren();
    mediaPlayer.hidden = true;
    mediaEmpty.hidden = false;
    mediaTitle.textContent = "Your media will appear here";
    mediaDetails.textContent = "Choose a file or paste a direct link to get started.";
    clearMediaButton.hidden = true;
    mediaStatus.textContent = "";
}

function showMediaPreview(type, source, name, sourceDescription, objectUrl = null) {
    clearMediaPreview();
    const loadVersion = mediaLoadVersion;
    let rewarded = false;
    activeMediaObjectUrl = objectUrl;
    mediaTitle.textContent = name;
    mediaDetails.textContent = `${type[0].toUpperCase()}${type.slice(1)} · ${sourceDescription}`;
    mediaEmpty.hidden = true;
    mediaPlayer.hidden = false;
    clearMediaButton.hidden = false;
    const rewardPreview = () => {
        if (!rewarded && loadVersion === mediaLoadVersion) {
            rewarded = true;
            recordProgress("mediaPreviews", 1, 5, "media previewed", { [`${type}Previews`]: 1 });
        }
    };

    const preview = type === "image"
        ? document.createElement("img")
        : document.createElement(type);
    if (type === "image") {
        preview.alt = `Preview of ${name}`;
        preview.addEventListener("load", () => {
            if (loadVersion === mediaLoadVersion) {
                mediaStatus.textContent = "Image preview loaded.";
                rewardPreview();
            }
        }, { once: true });
    } else {
        preview.controls = true;
        preview.preload = "metadata";
        if (type === "video") {
            preview.playsInline = true;
            preview.addEventListener("loadedmetadata", () => {
                if (loadVersion === mediaLoadVersion) {
                    mediaStatus.textContent = "Media is ready. Press play when you’re ready.";
                    rewardPreview();
                }
            }, { once: true });
        } else {
            preview.addEventListener("loadedmetadata", () => {
                if (loadVersion === mediaLoadVersion) {
                    mediaStatus.textContent = "Audio is ready. Press play when you’re ready.";
                    rewardPreview();
                }
            }, { once: true });
        }
    }
    preview.addEventListener("error", () => {
        if (loadVersion === mediaLoadVersion) {
            mediaStatus.textContent = "Your browser couldn't load this media. The format may not be supported, the link may require access, or the source may block playback.";
        }
    }, { once: true });
    preview.src = source;
    mediaPlayer.append(preview);

    if (source.startsWith("http")) {
        const sourceLink = document.createElement("a");
        sourceLink.className = "media-source-link";
        sourceLink.href = source;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        sourceLink.textContent = "Open source ↗";
        sourceLink.setAttribute("aria-label", `Open source for ${name} in a new tab`);
        mediaPlayer.append(sourceLink);
    }

}

document.getElementById("mediaUrlForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const rawUrl = mediaUrlInput.value.trim();
    if (!rawUrl) {
        mediaStatus.textContent = "Paste a direct media link or choose a file from this device.";
        mediaUrlInput.focus();
        return;
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(rawUrl);
    } catch {
        mediaStatus.textContent = "Enter a complete media link starting with https:// or http://.";
        return;
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        mediaStatus.textContent = "Only direct HTTP and HTTPS media links are supported.";
        return;
    }
    if (isYouTubeUrl(parsedUrl)) {
        mediaStatus.textContent = "Streaming-site pages aren't direct media files. Use the service's official player or download options.";
        return;
    }

    const name = filenameFromUrl(parsedUrl);
    const selectedType = mediaTypeSelect.value;
    const type = selectedType === "auto" ? inferMediaType(name) : selectedType;
    if (!type) {
        mediaStatus.textContent = "I couldn't identify an audio, video, or image file in that link. Check that it points directly to a supported media file.";
        return;
    }
    mediaFileInput.value = "";
    showMediaPreview(type, parsedUrl.href, name, `streamed from ${parsedUrl.hostname}`);
});

mediaFileInput.addEventListener("change", () => {
    const file = mediaFileInput.files?.[0];
    if (!file) {
        return;
    }
    const type = inferMediaType(file.name, file.type);
    if (!type) {
        mediaStatus.textContent = "Choose an audio, video, or image file supported by your browser.";
        mediaFileInput.value = "";
        return;
    }
    mediaUrlInput.value = "";
    const objectUrl = URL.createObjectURL(file);
    showMediaPreview(type, objectUrl, file.name, "on this device", objectUrl);
});

clearMediaButton.addEventListener("click", () => {
    clearMediaPreview();
    mediaUrlInput.value = "";
    mediaFileInput.value = "";
});

function queueFileUrl(rawUrl, requestedName = "") {
    const validation = validateDirectFileUrl(rawUrl);
    if (validation.error) {
        return { error: validation.error };
    }

    const parsedUrl = validation.parsedUrl;
    const existingItem = downloadQueue.find((item) => item.url === parsedUrl.href);
    if (existingItem) {
        return { duplicate: true, item: existingItem };
    }
    if (downloadQueue.length >= queueLimit) {
        return { error: `The queue is full. You can save up to ${queueLimit} links.` };
    }

    const filename = safeFilename(requestedName) ||
        safeFilename(suggestedFilename(parsedUrl, validation.provider)) ||
        "download";
    const item = {
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        url: parsedUrl.href,
        name: filename,
        addedAt: new Date().toISOString(),
    };
    downloadQueue = [...downloadQueue, item];
    if (!saveQueue()) {
        downloadQueue = downloadQueue.filter((queued) => queued.id !== item.id);
        return { error: "Couldn't save the queue. Check your browser storage settings." };
    }
    return { item };
}

function updateQueueIndicators() {
    document.getElementById("queueCount").textContent = String(downloadQueue.length);
    document.getElementById("queuedDownloads").textContent = String(downloadQueue.length);
    document.getElementById("queueSummary").textContent = downloadQueue.length
        ? `${downloadQueue.length} ${downloadQueue.length === 1 ? "link" : "links"} waiting`
        : "No links waiting";
    document.getElementById("openNextQueue").disabled = downloadQueue.length === 0;
    document.getElementById("clearQueue").disabled = downloadQueue.length === 0;
    document.getElementById("queueEmpty").hidden = downloadQueue.length > 0;
}

function renderQueue() {
    const queueList = document.getElementById("queueList");
    queueList.replaceChildren();
    downloadQueue.forEach((item, index) => {
        const row = document.createElement("article");
        row.className = "queue-item";

        const position = document.createElement("span");
        position.className = "queue-position";
        position.textContent = String(index + 1).padStart(2, "0");

        const details = document.createElement("div");
        details.className = "queue-details";
        const name = document.createElement("strong");
        name.textContent = item.name;
        const url = document.createElement("span");
        url.className = "queue-url";
        url.textContent = item.url;
        const addedAt = document.createElement("span");
        addedAt.className = "queue-added";
        addedAt.textContent = `Added ${new Date(item.addedAt).toLocaleString()}`;
        details.append(name, url, addedAt);

        const actions = document.createElement("div");
        actions.className = "queue-item-actions";
        const open = document.createElement("button");
        open.type = "button";
        open.className = "history-open";
        open.textContent = "Open link ↗";
        open.addEventListener("click", () => openQueuedItem(item.id));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "queue-remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `Remove ${item.name} from the queue`);
        remove.title = "Remove from queue";
        remove.addEventListener("click", () => removeQueuedItem(item.id));
        actions.append(open, remove);

        row.append(position, details, actions);
        queueList.append(row);
    });
    updateQueueIndicators();
}

function recordDownloadHistory(item) {
    downloadHistory = [
        { url: item.url, name: item.name, date: new Date().toISOString() },
        ...downloadHistory.filter((entry) => entry.url !== item.url),
    ].slice(0, historyLimit);
    const saved = saveHistory();
    renderHistory();
    return saved;
}

function openQueuedItem(id) {
    const item = downloadQueue.find((queued) => queued.id === id);
    if (!item) {
        return;
    }

    const parsedUrl = new URL(item.url);
    const provider = cloudShareProvider(parsedUrl);
    const link = document.createElement("a");
    link.href = parsedUrl.href;
    if (parsedUrl.origin === window.location.origin) {
        link.download = item.name;
    } else {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    }
    document.body.append(link);
    link.click();
    link.remove();

    downloadQueue = downloadQueue.filter((queued) => queued.id !== id);
    const queueSaved = saveQueue();
    const historySaved = recordDownloadHistory(item);
    recordProgress(
        "linksOpened",
        1,
        10,
        "queued link opened",
        provider
            ? { queueLinksOpened: 1, cloudLinksOpened: 1 }
            : { queueLinksOpened: 1 }
    );
    renderQueue();
    setQueueStatus(
        queueSaved
            ? historySaved
                ? provider
                    ? `Opened your ${provider} share. Use its Download option if shown; SurfyFriend does not bypass sign-in or sharing permissions.`
                    : `Opened ${item.name}. The source controls whether it downloads or opens a preview.`
                : `Opened ${item.name}, but this browser couldn't save it in history.`
            : `Opened ${item.name}, but couldn't update the saved queue. Refresh before opening another link.`
    );
}

function removeQueuedItem(id) {
    const previousQueue = downloadQueue;
    downloadQueue = downloadQueue.filter((item) => item.id !== id);
    if (!saveQueue()) {
        downloadQueue = previousQueue;
        renderQueue();
        setQueueStatus("Couldn't update the queue. Check your browser storage settings.");
        return;
    }
    renderQueue();
    setQueueStatus("Link removed from the queue.");
}

function setQueueStatus(message) {
    document.getElementById("queueStatus").textContent = message;
}

function addLinksToQueue(entries, source, addedCounter = "") {
    if (entries.length === 0) {
        return { message: "Select at least one link to add." };
    }

    let added = 0;
    let duplicates = 0;
    let invalid = 0;
    const errors = [];
    entries.forEach((entry, index) => {
        const url = typeof entry === "string" ? entry : entry.url;
        const name = typeof entry === "string" ? "" : entry.name;
        const result = queueFileUrl(url, name);
        if (result.error) {
            invalid += 1;
            if (errors.length < 3) {
                errors.push(`Item ${index + 1}: ${result.error}`);
            }
        } else if (result.duplicate) {
            duplicates += 1;
        } else {
            added += 1;
        }
    });

    if (added > 0) {
        const extraCounters = { batchAdds: 1 };
        if (addedCounter) {
            extraCounters[addedCounter] = added;
        }
        recordProgress(
            "queueItemsAdded",
            added,
            2,
            `${added} ${added === 1 ? "link" : "links"} added ${source}`,
            extraCounters
        );
    }
    renderQueue();
    const summary = `${added} added, ${duplicates} duplicate${duplicates === 1 ? "" : "s"}, ${invalid} invalid.`;
    return { message: errors.length ? `${summary} ${errors.join(" ")}` : summary };
}

function addSingleToQueue() {
    const result = queueFileUrl(urlInput.value, filenameInput.value);
    if (result.error) {
        status.textContent = result.error;
        return;
    }
    if (!result.duplicate) {
        recordProgress("queueItemsAdded", 1, 2, "link added to queue");
    }
    renderQueue();
    status.textContent = result.duplicate
        ? `${result.item.name} is already in your queue.`
        : `Added ${result.item.name} to your queue.`;
}

document.getElementById("addToQueue").addEventListener("click", addSingleToQueue);
document.getElementById("openNextQueue").addEventListener("click", () => {
    const nextItem = downloadQueue[0];
    if (nextItem) {
        openQueuedItem(nextItem.id);
    }
});
document.getElementById("clearQueue").addEventListener("click", () => {
    if (downloadQueue.length === 0 || !window.confirm("Clear all links from the download queue?")) {
        return;
    }
    const previousQueue = downloadQueue;
    downloadQueue = [];
    if (!saveQueue()) {
        downloadQueue = previousQueue;
        renderQueue();
        setQueueStatus("Couldn't clear the queue. Check your browser storage settings.");
        return;
    }
    renderQueue();
    setQueueStatus("Download queue cleared.");
});
document.getElementById("bulkQueueForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const lines = document.getElementById("bulkQueueUrls").value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) {
        setQueueStatus("Paste one or more file or supported cloud-share links first.");
        return;
    }
    const result = addLinksToQueue(lines, "from your batch");
    document.getElementById("bulkQueueUrls").value = "";
    setQueueStatus(result.message);
});

async function readHtmlWithinLimit(response, limit) {
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > limit) {
        throw new Error("That webpage is larger than the 5 MB scan limit.");
    }
    if (!response.body) {
        throw new Error("The webpage response could not be read.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    let bytesRead = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                return html + decoder.decode();
            }
            bytesRead += value.byteLength;
            if (bytesRead > limit) {
                await reader.cancel();
                throw new Error("That webpage is larger than the 5 MB scan limit.");
            }
            html += decoder.decode(value, { stream: true });
        }
    } finally {
        reader.releaseLock();
    }
}

function isDownloadCandidate(anchor, parsedUrl) {
    if (cloudShareProvider(parsedUrl)) {
        return true;
    }
    const fileExtension = /\.(?:7z|aac|aiff|apk|avi|bin|bz2|csv|docx?|epub|flac|gif|gz|heic|html?|jpe?g|m4a|m4v|mkv|mov|mp3|mp4|odp|ods|odt|ogg|pdf|png|pptx?|rar|svg|tar|txt|wav|webm|webp|xlsx?|zip)(?:$)/i;
    const linkDescription = [
        anchor.textContent,
        anchor.getAttribute("aria-label"),
        anchor.getAttribute("title"),
    ].filter(Boolean).join(" ");
    return anchor.hasAttribute("download") ||
        fileExtension.test(parsedUrl.pathname) ||
        /\b(download|save|original file|full[- ]size)\b/i.test(linkDescription);
}

function updatePageLinkSelection() {
    const selectedCount = document.querySelectorAll(
        "#pageLinkList input[data-page-link-index]:checked"
    ).length;
    const addButton = document.getElementById("addPageLinksToQueue");
    addButton.disabled = selectedCount === 0;
    addButton.textContent = selectedCount
        ? `Add ${selectedCount} selected to queue`
        : "Add selected to queue";
}

function renderPageLinkCandidates(candidates) {
    const results = document.getElementById("pageLinkResults");
    const list = document.getElementById("pageLinkList");
    list.replaceChildren();
    pageLinkCandidates = candidates;
    results.hidden = candidates.length === 0;
    document.getElementById("pageLinkCount").textContent =
        `${candidates.length} possible download ${candidates.length === 1 ? "link" : "links"} found`;

    candidates.forEach((candidate, index) => {
        const row = document.createElement("div");
        row.className = "page-link-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.pageLinkIndex = String(index);
        checkbox.setAttribute("aria-label", `Select ${candidate.name}`);
        checkbox.addEventListener("change", updatePageLinkSelection);
        const details = document.createElement("div");
        details.className = "page-link-details";
        const name = document.createElement("strong");
        name.textContent = candidate.name;
        const link = document.createElement("a");
        link.href = candidate.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = candidate.url;
        link.setAttribute("aria-label", `Open ${candidate.url} in a new tab`);
        details.append(name, link);
        row.append(checkbox, details);
        list.append(row);
    });
    updatePageLinkSelection();
}

document.getElementById("pageScanForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const rawUrl = document.getElementById("webpageUrl").value.trim();
    let pageUrl;
    try {
        pageUrl = new URL(rawUrl);
    } catch {
        document.getElementById("pageScanStatus").textContent =
            "Enter a complete webpage address starting with http:// or https://.";
        return;
    }
    if (!["http:", "https:"].includes(pageUrl.protocol) ||
        pageUrl.username ||
        pageUrl.password ||
        isYouTubeUrl(pageUrl)
    ) {
        document.getElementById("pageScanStatus").textContent =
            "Enter a public HTTP or HTTPS webpage address. Sign-in pages and streaming pages aren't supported.";
        return;
    }

    const scanButton = document.getElementById("scanPageButton");
    const scanStatus = document.getElementById("pageScanStatus");
    scanButton.disabled = true;
    scanStatus.textContent = "Checking the page for file links…";
    renderPageLinkCandidates([]);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(pageUrl.href, {
            credentials: "omit",
            mode: "cors",
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`The page returned HTTP ${response.status}.`);
        }
        const contentType = response.headers.get("content-type") || "";
        if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
            throw new Error("That address did not return a webpage.");
        }
        const html = await readHtmlWithinLimit(response, 5 * 1024 * 1024);
        const page = new DOMParser().parseFromString(html, "text/html");
        const baseHref = page.querySelector("base[href]")?.getAttribute("href") || response.url || pageUrl.href;
        const found = [];
        const seenUrls = new Set();
        for (const anchor of page.querySelectorAll("a[href]")) {
            let linkUrl;
            try {
                linkUrl = new URL(anchor.getAttribute("href"), baseHref);
            } catch {
                continue;
            }
            if (!["http:", "https:"].includes(linkUrl.protocol) ||
                isYouTubeUrl(linkUrl) ||
                !isDownloadCandidate(anchor, linkUrl) ||
                seenUrls.has(linkUrl.href)
            ) {
                continue;
            }
            seenUrls.add(linkUrl.href);
            const provider = cloudShareProvider(linkUrl);
            const suggestedName = suggestedFilename(linkUrl, provider) || "download";
            const anchorName = safeFilename(anchor.textContent.trim());
            found.push({
                url: linkUrl.href,
                name: provider
                    ? suggestedName
                    : suggestedName === "download" || suggestedName === "view"
                        ? anchorName || suggestedName
                        : suggestedName,
            });
            if (found.length >= 50) {
                break;
            }
        }
        renderPageLinkCandidates(found);
        recordProgress("pageScans", 1, 1, "webpage scanned");
        scanStatus.textContent = found.length
            ? "Select the links you want to add to your queue."
            : "No likely download links found. The page may add links with JavaScript or block browser access.";
    } catch (error) {
        console.error("Could not scan webpage for download links.", error);
        scanStatus.textContent = error.name === "AbortError"
            ? "The page scan timed out. Try again or use the batch link box on Download queue."
            : `Couldn't scan that page. It may block browser access (CORS) or require sign-in. ${error.message}`;
        renderPageLinkCandidates([]);
    } finally {
        window.clearTimeout(timeout);
        scanButton.disabled = false;
    }
});

document.getElementById("addPageLinksToQueue").addEventListener("click", () => {
    const selected = Array.from(
        document.querySelectorAll("#pageLinkList input[data-page-link-index]:checked")
    ).map((checkbox) => pageLinkCandidates[Number(checkbox.dataset.pageLinkIndex)]);
    const result = addLinksToQueue(selected, "from the webpage scan", "pageLinksQueued");
    document.getElementById("pageScanStatus").textContent = result.message;
});

function clearHistory() {
    if (downloadHistory.length === 0) {
        return;
    }
    if (!window.confirm("Clear all saved download history from this device?")) {
        return;
    }
    const previousHistory = downloadHistory;
    downloadHistory = [];
    if (!saveHistory()) {
        downloadHistory = previousHistory;
        showHistoryStatus("History could not be cleared. Check your browser storage settings.");
        return;
    }
    renderHistory();
    showHistoryStatus("Download history cleared.");
}

function showHistoryStatus(message) {
    const page = window.location.hash.slice(1);
    const target = page === "settings"
        ? document.getElementById("settingsStatus")
        : page === "history"
            ? document.getElementById("historyStatus")
            : status;
    target.textContent = message;
}

document.getElementById("clearHistory").addEventListener("click", clearHistory);
document.getElementById("clearHistorySettings").addEventListener("click", clearHistory);

document.getElementById("resetProgress").addEventListener("click", () => {
    if (!window.confirm("Reset all SurfyFriend points, levels, and achievements on this device?")) {
        return;
    }
    const previousProgress = progress;
    progress = emptyProgress();
    try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch (error) {
        console.error("Could not reset SurfyFriend progress.", error);
        progress = previousProgress;
        document.getElementById("settingsStatus").textContent =
            "Progress couldn't be reset. Check your browser storage settings.";
        return;
    }
    renderProgress("Your points and achievements have been reset.");
    renderExplorerHistory();
    scheduleAccountSync();
    document.getElementById("settingsStatus").textContent = "Progress reset on this device.";
});

async function downloadHtmlPage(parsedUrl, filename) {
    if (!["http:", "https:"].includes(window.location.protocol)) {
        throw new Error("Downloading webpage HTML requires the SurfyFriend Python backend. Start python3 server.py and open its HTTP(S) address.");
    }
    const response = await fetch("/api/download/webpage", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
            Accept: "application/json, text/html",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: parsedUrl.href, filename }),
    });
    const contentType = response.headers.get("Content-Type") || "";
    if (!response.ok) {
        if (contentType.includes("application/json")) {
            const error = await response.json();
            throw new Error(error.error || `The HTML download failed (HTTP ${response.status}).`);
        }
        throw new Error("The HTML download service is unavailable at this address.");
    }
    if (contentType.includes("application/json")) {
        const result = await response.json();
        if (result.downloaded === false) {
            return false;
        }
        throw new Error("The HTML download service returned an unsupported response.");
    }
    if (
        !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml+xml")
    ) {
        throw new Error("The HTML download service returned an unsupported response.");
    }
    const encodedFilename = response.headers.get("X-SurfyFriend-Filename");
    const downloadName = encodedFilename
        ? decodeURIComponent(encodedFilename)
        : filename;
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = downloadName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    return downloadName;
}

function openOriginalLink(parsedUrl, filename) {
    const link = document.createElement("a");
    link.href = parsedUrl.href;
    if (parsedUrl.origin === window.location.origin) {
        link.download = filename;
    } else {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    }
    document.body.append(link);
    link.click();
    link.remove();
}

async function openDirectDownload() {
    const rawUrl = urlInput.value.trim();
    if (!rawUrl) {
        status.textContent = "Enter a file link or supported cloud-share URL.";
        return;
    }

    const validation = validateDirectFileUrl(rawUrl);
    if (validation.error) {
        status.textContent = validation.error;
        return;
    }
    const parsedUrl = validation.parsedUrl;

    const requestedName = safeFilename(filenameInput.value);
    const filename = requestedName || suggestedFilename(parsedUrl, validation.provider);
    if (!validation.provider && mayBeHtmlPage(parsedUrl)) {
        status.textContent = "Checking whether this link is an HTML page…";
        try {
            const downloaded = await downloadHtmlPage(parsedUrl, filename);
            if (downloaded) {
                recordProgress("linksOpened", 1, 10, "webpage HTML downloaded");
                const saved = recordDownloadHistory({ url: parsedUrl.href, name: downloaded });
                status.textContent = saved
                    ? `Downloaded the webpage HTML as ${downloaded}. Images and linked files are not included.`
                    : `Downloaded the webpage HTML as ${downloaded}, but this browser could not save it in history.`;
                return;
            }
        } catch (error) {
            console.error("Could not download webpage HTML.", error);
            status.textContent = error.message;
            return;
        }
    }
    if (!validation.provider) {
        openOriginalLink(parsedUrl, filename);
    } else {
        const link = document.createElement("a");
        link.href = parsedUrl.href;
        link.download = filename;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.append(link);
        link.click();
        link.remove();
    }

    recordProgress(
        "linksOpened",
        1,
        10,
        validation.provider ? `${validation.provider} share opened` : "direct link opened",
        validation.provider ? { cloudLinksOpened: 1 } : {}
    );
    const saved = recordDownloadHistory({ url: parsedUrl.href, name: filename });
    status.textContent = validation.provider
        ? saved
            ? `Opened your ${validation.provider} share. Use its Download option if shown; provider access rules still apply.`
            : `Opened your ${validation.provider} share, but this browser could not save it in your history.`
        : saved
            ? `Opened the direct link for ${filename}. The source site controls whether it downloads or opens in a tab.`
            : `Opened the direct link for ${filename}, but this browser could not save it in your history.`;
}

document.getElementById("downloadForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    openDirectDownload().finally(() => {
        submitButton.disabled = false;
    });
});

document.getElementById("pasteUrl").addEventListener("click", async () => {
    if (!navigator.clipboard?.readText) {
        status.textContent = "Clipboard access is unavailable. Paste the link into the field instead.";
        return;
    }
    try {
        urlInput.value = await navigator.clipboard.readText();
        urlInput.focus();
        updateLinkHint();
        status.textContent = "Link pasted. Check it, then open the direct download.";
    } catch (error) {
        console.error("Could not read from clipboard.", error);
        status.textContent = "Clipboard access was denied. Paste the link into the field instead.";
    }
});

function setTheme(theme, persist = true) {
    if (fullVersionStatusKnown && !fullVersionAvailable) {
        theme = "light";
        persist = false;
    }
    if (!themes.includes(theme)) {
        theme = "light";
    }
    const isDark = theme === "dark" || theme === "midnight";
    document.body.classList.toggle("dark-mode", isDark);
    document.body.classList.remove(...themes.map((name) => `theme-${name}`));
    document.body.classList.add(`theme-${theme}`);
    document.getElementById("themeToggleIcon").textContent = "◐";
    themeToggle.setAttribute("aria-label", `Change color theme (current: ${themeLabels[theme]})`);
    themeToggle.title = `Change color theme (current: ${themeLabels[theme]})`;
    document.querySelectorAll(".theme-option").forEach((button) => {
        const isSelected = button.dataset.theme === theme;
        button.classList.toggle("selected", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
    });
    const themeColor = document.querySelector('meta[name="theme-color"]');
    themeColor.content = getComputedStyle(document.body).getPropertyValue("--page").trim();
    if (persist) {
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch (error) {
            console.error("Could not save theme preference.", error);
        }
    }
}

let savedTheme = "light";
try {
    const savedThemePreference = localStorage.getItem(THEME_KEY);
    savedTheme = themes.includes(savedThemePreference) ? savedThemePreference : "light";
} catch (error) {
    console.error("Could not read theme preference.", error);
}
setTheme("light", false);

themeToggle.addEventListener("click", () => {
    if (!fullVersionAvailable) {
        return;
    }
    const currentTheme = themes.find((theme) => document.body.classList.contains(`theme-${theme}`)) || "light";
    setTheme(themes[(themes.indexOf(currentTheme) + 1) % themes.length]);
});
document.querySelectorAll(".theme-option").forEach((button) => {
    button.addEventListener("click", () => {
        if (fullVersionAvailable) {
            setTheme(button.dataset.theme);
        }
    });
});
const soundEffectsToggle = document.getElementById("soundEffectsToggle");
soundEffectsToggle.checked = soundEffectsEnabled;
soundEffectsToggle.addEventListener("change", () => {
    soundEffectsEnabled = soundEffectsToggle.checked;
    try {
        localStorage.setItem(SOUND_KEY, soundEffectsEnabled ? "on" : "off");
        document.getElementById("soundEffectsStatus").textContent =
            soundEffectsEnabled ? "Sound effects are on." : "Sound effects are off.";
        playUiSound("success");
    } catch (error) {
        console.error("Could not save sound preference.", error);
        soundEffectsEnabled = false;
        soundEffectsToggle.checked = false;
        document.getElementById("soundEffectsStatus").textContent =
            "Could not save this setting. Sound effects remain off.";
    }
});
document.getElementById("quickDownload").addEventListener("click", () => showPage("downloader"));
document.getElementById("quickQueue").addEventListener("click", () => showPage("queue"));
function showShareDialog(message = "") {
    shareUrlInput.value = window.location.href;
    const isLocalAddress = window.location.protocol === "file:" ||
        ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    document.getElementById("shareDialogDescription").textContent = isLocalAddress
        ? "This address is local to this computer. To share SurfyFriend with others, use a hosted web address."
        : "Copy this link to share SurfyFriend.";
    shareDialogStatus.textContent = message;
    if (!shareDialog.open) {
        shareDialog.showModal();
    }
    shareUrlInput.focus();
    shareUrlInput.select();
    shareStatus.textContent = "Share options opened.";
}

document.getElementById("shareSite").addEventListener("click", async () => {
    const shareData = {
        title: "SurfyFriend — Direct File Downloader",
        text: "Explore SurfyFriend, your friendly place for direct downloads.",
        url: window.location.href,
    };
    if (navigator.share && ["http:", "https:"].includes(window.location.protocol)) {
        try {
            await navigator.share(shareData);
            shareStatus.textContent = "SurfyFriend share sheet opened.";
            return;
        } catch (error) {
            if (error?.name === "AbortError") {
                return;
            }
            console.error("Could not open the SurfyFriend share sheet.", error);
            showShareDialog("The share sheet was unavailable. You can copy the link instead.");
        }
        return;
    }
    showShareDialog();
});
document.getElementById("shareDialogClose").addEventListener("click", () => shareDialog.close());
shareDialog.addEventListener("click", (event) => {
    if (event.target === shareDialog) {
        shareDialog.close();
    }
});
document.getElementById("copyShareLink").addEventListener("click", async () => {
    shareUrlInput.focus();
    shareUrlInput.select();
    try {
        if (!navigator.clipboard?.writeText) {
            throw new Error("Clipboard access is unavailable in this browser.");
        }
        await navigator.clipboard.writeText(shareUrlInput.value);
        shareDialogStatus.textContent = "Link copied to the clipboard.";
        shareStatus.textContent = "SurfyFriend link copied to the clipboard.";
    } catch (error) {
        console.error("Could not copy the SurfyFriend link.", error);
        shareDialogStatus.textContent =
            "Clipboard access was blocked. The link is selected; press Command+C or Ctrl+C to copy it.";
    }
});
toolbarAccountButton.addEventListener("click", () => {
    if (!toolbarAccountDialog.open) {
        toolbarAccountDialog.showModal();
    }
});
document.getElementById("toolbarAccountClose").addEventListener("click", () => toolbarAccountDialog.close());
toolbarAccountDialog.addEventListener("click", (event) => {
    if (event.target === toolbarAccountDialog) {
        toolbarAccountDialog.close();
    }
});
toolbarToolsButton.addEventListener("click", () => {
    const isExpanded = toolbarToolsButton.getAttribute("aria-expanded") === "true";
    toolbarToolsButton.setAttribute("aria-expanded", String(!isExpanded));
    toolbarToolsMenu.hidden = isExpanded;
});
function closeToolbarTools() {
    toolbarToolsMenu.hidden = true;
    toolbarToolsButton.setAttribute("aria-expanded", "false");
}
document.querySelectorAll("[data-toolbar-page]").forEach((button) => {
    button.addEventListener("click", () => {
        closeToolbarTools();
        showPage(button.dataset.toolbarPage);
    });
});
toolbarAccountDialog.querySelectorAll("[data-page]").forEach((link) => {
    link.addEventListener("click", (event) => {
        event.preventDefault();
        toolbarAccountDialog.close();
        showPage(link.dataset.page);
    });
});
document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".toolbar-tools")) {
        closeToolbarTools();
    }
});
toolbarSearch.addEventListener("input", () => {
    if (toolbarSearch.value.trim() && window.location.hash !== "#history") {
        showPage("history");
    } else {
        renderHistory();
    }
});

const uploadForm = document.getElementById("uploadForm");
const uploadFilesInput = document.getElementById("uploadFiles");
const uploadDropzone = document.getElementById("uploadDropzone");
const uploadSelection = document.getElementById("uploadSelection");
const uploadStatus = document.getElementById("uploadStatus");
const uploadProgress = document.getElementById("uploadProgress");
const uploadSubmit = document.getElementById("uploadSubmit");
const uploadedFileList = document.getElementById("uploadedFileList");
const uploadsEmpty = document.getElementById("uploadsEmpty");
const uploadsSummary = document.getElementById("uploadsSummary");
const networkSharingStatus = document.getElementById("networkSharingStatus");
const maxUploadBytes = 500 * 1024 * 1024;
let uploadServerStatus = null;
let selectedUploadFiles = [];

function formatLocalFileSize(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const units = ["KB", "MB", "GB"];
    let size = bytes / 1024;
    let unit = units[0];
    for (let index = 1; size >= 1024 && index < units.length; index += 1) {
        size /= 1024;
        unit = units[index];
    }
    return `${size.toFixed(size >= 10 ? 0 : 1)} ${unit}`;
}

function showSelectedUploadFiles(files) {
    selectedUploadFiles = files;
    uploadSelection.replaceChildren();

    if (files.length === 0) {
        uploadSelection.textContent = "No files selected";
        return;
    }

    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    const summary = document.createElement("strong");
    summary.textContent = `${files.length} ${files.length === 1 ? "file" : "files"} selected · ${formatLocalFileSize(totalBytes)} total`;
    const list = document.createElement("ul");
    list.className = "upload-selection-list";
    files.slice(0, 5).forEach((file) => {
        const item = document.createElement("li");
        item.textContent = `${file.name} (${formatLocalFileSize(file.size)})`;
        list.append(item);
    });
    if (files.length > 5) {
        const remaining = document.createElement("li");
        remaining.textContent = `and ${files.length - 5} more`;
        list.append(remaining);
    }
    uploadSelection.append(summary, list);

    const tooLarge = files.find((file) => file.size > maxUploadBytes);
    uploadStatus.textContent = tooLarge
        ? `${tooLarge.name} is larger than the 500 MB per-file limit.`
        : "";
}

function renderUploadedFiles(files) {
    uploadedFileList.replaceChildren();
    uploadsEmpty.hidden = files.length > 0;
    uploadsSummary.textContent = files.length === 1
        ? "1 file saved on this computer"
        : `${files.length} files saved on this computer`;
    for (const file of files) {
        const row = document.createElement("article");
        row.className = "uploaded-file";
        const icon = document.createElement("span");
        icon.className = "uploaded-file-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "▤";
        const details = document.createElement("div");
        details.className = "uploaded-file-details";
        const name = document.createElement("strong");
        name.textContent = file.name;
        const meta = document.createElement("span");
        const modified = new Date(file.modifiedAt);
        const dateText = Number.isNaN(modified.valueOf()) ? "" : ` · ${modified.toLocaleString()}`;
        meta.textContent = `${formatLocalFileSize(file.bytes)}${dateText}`;
        details.append(name, meta);
        const actions = document.createElement("div");
        actions.className = "uploaded-file-actions";
        const download = document.createElement("a");
        download.className = "uploaded-download";
        download.href = `/api/uploads/${encodeURIComponent(file.id)}`;
        download.textContent = "Download";
        download.setAttribute("aria-label", `Download ${file.name}`);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "queue-remove";
        remove.textContent = "×";
        remove.title = `Delete ${file.name}`;
        remove.setAttribute("aria-label", `Delete ${file.name}`);
        remove.addEventListener("click", () => deleteUploadedFile(file));
        actions.append(download, remove);
        row.append(icon, details, actions);
        uploadedFileList.append(row);
    }
}

async function loadUploadedFiles() {
    if (window.location.protocol !== "http:") {
        renderUploadedFiles([]);
        uploadsSummary.textContent = "Local server required";
        uploadStatus.textContent = "Start the local server and open the HTTP address shown here. The uploader is not available from a file:// page.";
        return;
    }
    try {
        const statusResponse = await fetch("/api/status", { headers: { Accept: "application/json" } });
        if (!statusResponse.ok) {
            throw new Error(`The local server returned HTTP ${statusResponse.status}.`);
        }
        const serverStatus = await statusResponse.json();
        if (typeof serverStatus.networkEnabled !== "boolean" ||
            typeof serverStatus.uploadsEnabled !== "boolean" ||
            (serverStatus.networkUrl !== null && typeof serverStatus.networkUrl !== "string")
        ) {
            throw new Error("The local server returned an invalid status.");
        }
        uploadServerStatus = serverStatus;
        if (!serverStatus.uploadsEnabled) {
            uploadForm.hidden = true;
            renderUploadedFiles([]);
            uploadsSummary.textContent = "Disabled on hosted service";
            uploadStatus.textContent =
                "The local file shelf is disabled on public deployments to prevent unauthenticated file access.";
            networkSharingStatus.textContent = "Public SurfyFriend hosting does not expose the local file shelf.";
            return;
        }
        uploadForm.hidden = false;
        networkSharingStatus.textContent = serverStatus.networkEnabled
            ? `Sharing is ON. Other devices on your local network can open ${serverStatus.networkUrl}. Access has no password and uses unencrypted HTTP.`
            : "Sharing is OFF. Restart the server with python3 server.py --lan to let devices on your Wi-Fi/LAN access this file shelf.";
        const response = await fetch("/api/uploads", { headers: { Accept: "application/json" } });
        if (!response.ok) {
            throw new Error(`The local server returned HTTP ${response.status}.`);
        }
        const files = await response.json();
        if (!Array.isArray(files) || files.some((file) =>
            !file ||
            typeof file.id !== "string" ||
            typeof file.name !== "string" ||
            !Number.isFinite(file.bytes) ||
            typeof file.modifiedAt !== "string"
        )) {
            throw new Error("The local server returned an invalid file list.");
        }
        renderUploadedFiles(files);
        uploadStatus.textContent = "";
    } catch (error) {
        console.error("Could not load local uploads.", error);
        uploadServerStatus = null;
        renderUploadedFiles([]);
        uploadsSummary.textContent = "Local file shelf unavailable";
        uploadStatus.textContent = "Could not reach the local file server. Start it with python3 server.py from the SurfyFriend project folder, then reload this page.";
    }
}

function uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", "/api/uploads");
        request.setRequestHeader("Content-Type", "application/octet-stream");
        request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
        request.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
                onProgress(event.loaded);
            }
        });
        request.addEventListener("load", () => {
            if (request.status < 200 || request.status >= 300) {
                let message = `Upload failed (HTTP ${request.status}).`;
                try {
                    message = JSON.parse(request.responseText).error || message;
                } catch (error) {
                    console.error("Could not parse the local upload error.", error);
                }
                reject(new Error(message));
                return;
            }
            resolve();
        });
        request.addEventListener("error", () => reject(new Error("The connection to the local server was interrupted.")));
        request.addEventListener("timeout", () => reject(new Error("The upload timed out.")));
        request.timeout = 0;
        request.send(file);
    });
}

uploadFilesInput.addEventListener("change", () => {
    showSelectedUploadFiles(Array.from(uploadFilesInput.files || []));
});

uploadDropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadDropzone.classList.add("dragging");
});
uploadDropzone.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget || !uploadDropzone.contains(event.relatedTarget)) {
        uploadDropzone.classList.remove("dragging");
    }
});
uploadDropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadDropzone.classList.remove("dragging");
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length === 0) {
        uploadStatus.textContent = "Drop one or more files here to add them.";
        return;
    }
    showSelectedUploadFiles(files);
});

uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const files = selectedUploadFiles;
    if (window.location.protocol !== "http:" || !uploadServerStatus) {
        uploadStatus.textContent = "Open this page from the running local server to use the uploader.";
        return;
    }
    if (files.length === 0) {
        uploadStatus.textContent = "Choose at least one file to upload.";
        return;
    }
    const tooLarge = files.find((file) => file.size > maxUploadBytes);
    if (tooLarge) {
        uploadStatus.textContent = `${tooLarge.name} is larger than the 500 MB per-file limit.`;
        return;
    }

    uploadSubmit.disabled = true;
    uploadProgress.hidden = false;
    uploadProgress.value = 0;
    let uploaded = 0;
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    let completedBytes = 0;
    try {
        for (const [index, file] of files.entries()) {
            uploadStatus.textContent = `Uploading file ${index + 1} of ${files.length}: ${file.name}`;
            await uploadFile(file, (loadedBytes) => {
                uploadProgress.value = totalBytes
                    ? Math.round(((completedBytes + loadedBytes) / totalBytes) * 100)
                    : Math.round((uploaded / files.length) * 100);
            });
            uploaded += 1;
            completedBytes += file.size;
            uploadProgress.value = totalBytes
                ? Math.round((completedBytes / totalBytes) * 100)
                : Math.round((uploaded / files.length) * 100);
        }
        uploadFilesInput.value = "";
        showSelectedUploadFiles([]);
        await loadUploadedFiles();
        uploadStatus.textContent = `${uploaded} ${uploaded === 1 ? "file" : "files"} uploaded to this computer.`;
        recordProgress("filesUploaded", uploaded, 10, `${uploaded} ${uploaded === 1 ? "file" : "files"} saved`);
    } catch (error) {
        console.error("Could not upload selected file.", error);
        await loadUploadedFiles();
        const completed = uploaded
            ? `${uploaded} ${uploaded === 1 ? "file finished" : "files finished"} before the error.`
            : "";
        uploadStatus.textContent = `${error.message} ${completed}`.trim();
        if (uploaded > 0) {
            recordProgress("filesUploaded", uploaded, 10, `${uploaded} ${uploaded === 1 ? "file" : "files"} saved`);
        }
    } finally {
        uploadSubmit.disabled = false;
        uploadProgress.hidden = true;
    }
});

async function deleteUploadedFile(file) {
    if (!window.confirm(`Delete "${file.name}" from this computer?`)) {
        return;
    }
    try {
        const response = await fetch(`/api/uploads/${encodeURIComponent(file.id)}`, { method: "DELETE" });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `The local server returned HTTP ${response.status}.`);
        }
        await loadUploadedFiles();
        uploadStatus.textContent = `${file.name} deleted from this computer.`;
    } catch (error) {
        console.error("Could not delete local upload.", error);
        uploadStatus.textContent = `Could not delete ${file.name}: ${error.message}`;
    }
}

document.getElementById("refreshUploads").addEventListener("click", loadUploadedFiles);

const helperMessages = document.getElementById("helperMessages");
const websiteCheckerForm = document.getElementById("websiteCheckerForm");
const websiteCheckerSubmit = document.getElementById("websiteCheckerSubmit");
const websiteCheckerStatus = document.getElementById("websiteCheckerStatus");
const websiteCheckerResult = document.getElementById("websiteCheckerResult");

function renderWebsiteCheckResult(result) {
    const tlsLabels = {
        valid: "Valid and trusted",
        invalid: "Certificate problem",
        not_applicable: "No HTTPS certificate",
        error: "Unable to verify",
    };
    const malwareLabels = {
        clean: "No detections in latest report",
        flagged: "Flagged by security engines",
        pending: "Scan queued",
        not_configured: "Unavailable",
        unavailable: "No completed report",
        error: "Unable to check",
    };
    const tls = result.tls;
    const malware = result.malware;
    if (!tls || !malware || typeof tls.status !== "string" || typeof malware.status !== "string") {
        throw new Error("The website checker returned an unsupported result.");
    }
    const tlsStatus = document.getElementById("websiteCheckerTlsStatus");
    tlsStatus.textContent = tlsLabels[tls.status] || tlsLabels.error;
    tlsStatus.dataset.status = tls.status;
    document.getElementById("websiteCheckerTlsMessage").textContent = tls.message;
    const malwareStatus = document.getElementById("websiteCheckerMalwareStatus");
    malwareStatus.textContent = malwareLabels[malware.status] || malwareLabels.error;
    malwareStatus.dataset.status = malware.status;
    document.getElementById("websiteCheckerMalwareMessage").textContent = malware.message;
    document.getElementById("websiteCheckerProvider").textContent = malware.provider || "Reputation service";
    const statsElement = document.getElementById("websiteCheckerMalwareStats");
    const stats = malware.stats && typeof malware.stats === "object"
        ? Object.entries(malware.stats)
            .filter(([, count]) => Number.isSafeInteger(count) && count >= 0)
            .map(([name, count]) => `${name}: ${count}`)
        : [];
    statsElement.textContent = stats.join(" · ");
    statsElement.hidden = stats.length === 0;
    websiteCheckerResult.hidden = false;
}

websiteCheckerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    websiteCheckerSubmit.disabled = true;
    websiteCheckerResult.hidden = true;
    websiteCheckerStatus.textContent = "Checking the certificate and latest reputation report…";
    try {
        const response = await fetch("/api/security/check", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ url: document.getElementById("websiteCheckerUrl").value.trim() }),
        });
        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("application/json")) {
            throw new Error("The website checker is not available at this address.");
        }
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `The website check failed (HTTP ${response.status}).`);
        }
        renderWebsiteCheckResult(result);
        websiteCheckerStatus.textContent = `Check complete for ${result.target}.`;
    } catch (error) {
        console.error("Could not check website security.", error);
        websiteCheckerStatus.textContent = error.message;
    } finally {
        websiteCheckerSubmit.disabled = false;
    }
});

async function initializeWebsiteChecker() {
    if (!["http:", "https:"].includes(window.location.protocol)) {
        websiteCheckerSubmit.disabled = true;
        websiteCheckerStatus.textContent =
            "Website checks require the SurfyFriend Python backend. Start python3 server.py and open its HTTP(S) address.";
        return;
    }
    try {
        const response = await fetch("/api/security/status", {
            credentials: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json" },
        });
        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("application/json")) {
            throw new Error("The website checker service is unavailable.");
        }
        const service = await response.json();
        if (!response.ok) {
            throw new Error(service.error || `The website checker service failed (HTTP ${response.status}).`);
        }
        websiteCheckerStatus.textContent = service.malwareScanEnabled
            ? "Certificate checks are ready. VirusTotal reputation lookups are enabled on this server."
            : "Certificate checks are ready. Malware lookups need the SURFRYFRIEND_VIRUSTOTAL_API_KEY server setting.";
    } catch (error) {
        console.error("Could not initialize website checker.", error);
        websiteCheckerStatus.textContent = error.message;
    }
}

function setFullVersionAvailability(available) {
    const notice = document.getElementById("fullVersionNotice");
    const lockBadges = document.querySelectorAll("[data-full-version-lock]");
    fullVersionAvailable = available;
    fullVersionStatusKnown = true;
    notice.hidden = available;
    lockBadges.forEach((badge) => {
        badge.hidden = available;
    });
    themeToggle.disabled = !available;
    document.querySelectorAll(".theme-option").forEach((button) => {
        button.disabled = !available;
    });
    document.querySelectorAll("[data-go], [data-toolbar-page]").forEach((button) => {
        const targetPage = button.dataset.go || button.dataset.toolbarPage;
        if (targetPage && !["home", "downloader", "settings"].includes(targetPage)) {
            button.disabled = !available;
        }
    });
    document.getElementById("quickQueue").disabled = !available;
    updateAccountPanel();
    setTheme(available ? savedTheme : "light", false);
    if (!available) {
        themeToggle.setAttribute("aria-label", "Themes require the full Python version");
        themeToggle.title = "Themes require the full Python version";
    }
    document.querySelectorAll(".sidebar [data-page]").forEach((link) => {
        const isAvailableWithoutFullVersion = ["home", "downloader", "settings"].includes(link.dataset.page);
        if (available || isAvailableWithoutFullVersion) {
            link.removeAttribute("aria-disabled");
            link.removeAttribute("tabindex");
        } else {
            link.setAttribute("aria-disabled", "true");
            link.tabIndex = -1;
        }
    });
    if (!available && fullVersionOnlyPages.has(currentPageName)) {
        showPage("home", true, false);
    }
}

async function initializeFullVersionStatus() {
    if (!["http:", "https:"].includes(window.location.protocol)) {
        setFullVersionAvailability(false);
        return;
    }

    try {
        const response = await fetch("/api/status", {
            cache: "no-store",
            headers: { Accept: "application/json" },
        });
        if (!response.ok) {
            throw new Error(`The server returned HTTP ${response.status}.`);
        }
        const service = await response.json();
        if (
            typeof service.networkEnabled !== "boolean" ||
            typeof service.uploadsEnabled !== "boolean" ||
            (service.networkUrl !== null && typeof service.networkUrl !== "string")
        ) {
            throw new Error("The server did not return a valid SurfyFriend status.");
        }
        setFullVersionAvailability(true);
    } catch (error) {
        console.info("The full SurfyFriend Python version was not detected.", error);
        setFullVersionAvailability(false);
    }
}

const helperInput = document.getElementById("helperInput");

function addHelperMessage(message, role, action) {
    const bubble = document.createElement("div");
    bubble.className = `helper-message ${role === "user" ? "user-message" : "assistant-message"}`;
    bubble.textContent = message;
    helperMessages.append(bubble);
    if (action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "helper-action";
        button.textContent = action.label;
        button.addEventListener("click", () => {
            if (action.url) {
                urlInput.value = action.url;
                updateLinkHint();
            }
            showPage(action.page);
            if (action.focus) {
                const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
                document.getElementById(action.focus)?.scrollIntoView({ behavior, block: "center" });
            }
        });
        helperMessages.append(button);
    }
    while (helperMessages.children.length > 24) {
        helperMessages.firstElementChild.remove();
    }
    helperMessages.scrollTop = helperMessages.scrollHeight;
}

function getHelperReply(question) {
    const text = question.toLowerCase().replace(/[’']/g, "");
    const mentionedUrl = question.match(/https?:\/\/[^\s<>]+/i)?.[0].replace(/[),.!?;]+$/, "");
    const currentUrl = urlInput.value.trim();
    const candidateUrl = mentionedUrl || currentUrl;
    const openDownloader = { label: "Open Downloader", page: "downloader" };
    const openUploads = { label: "Open My uploads", page: "uploads" };

    if (/youtube|streaming/.test(text) ||
        (/(download|extract)/.test(text) && /video/.test(text))
    ) {
        return {
            message: "SurfyFriend cannot download or extract videos from YouTube or streaming pages. It can open direct file links and supported cloud shares, but not bypass stream protections. Use the service's official download or offline-viewing options where available.",
            action: openDownloader,
        };
    }

    if (/media|player|play|listen|preview|audio|video|view.*image/.test(text)) {
        return {
            message: "Open Media player to play a direct audio or video file, preview an image, or choose a file from this device. Streaming-service pages and sign-in pages are not media files, and browser support varies by format. Local files stay in your browser and are not uploaded.",
            action: { label: "Open Media player", page: "media" },
        };
    }

    if (/safe|virus|malware|secure|trustworthy/.test(text)) {
        return {
            message: "I can check whether a URL uses a supported format, but I can’t scan a link or file for viruses, verify who controls a site, or guarantee it is safe. Only open links from sources you trust, and use your browser’s or security software’s warnings as a guide.",
            action: openDownloader,
        };
    }

    if (/suggest(ed)? (web)?sites?|recommend.*sites?|site recommendations|website recommendations/.test(text)) {
        return {
            message: "Open Suggested websites to browse curated sources for software, media, books, open data, or official social-account exports. Puter AI can also suggest other websites from its existing knowledge when you request picks. It does not search the web, so suggestions beyond SurfyFriend's list are unverified; the selected topic and curated list are sent to Puter only when you request AI picks.",
            action: { label: "View Suggested websites", page: "sites" },
        };
    }

    if (/privacy|private|ai|data|sent|track/.test(text)) {
        return {
            message: "The built-in helper runs locally and does not contact an AI service. Suggested websites' AI picks are optional: when you click Get AI picks, SurfyFriend sends the selected topic and its curated website list to Puter, which can also suggest other sites from its existing knowledge. Outside suggestions are unverified and are not from a live web search. Puter may require sign-in and its user-pays model can use your allowance or billing. Your download history and queue are not sent. Local uploads stay in ~/.dropzone/uploads; --lan sharing is unencrypted.",
        };
    }

    if (/sharing|lan|wifi|wi-fi|network access/.test(text)) {
        if (!uploadServerStatus) {
            return {
                message: "Network sharing is off by default. Visit My uploads while connected to the local server to check its current status. Enabling `python3 server.py --lan` allows other devices on your Wi-Fi/LAN to read, add, and delete files without a password or encryption, so only use it on a trusted network.",
                action: openUploads,
            };
        }
        return {
            message: uploadServerStatus.networkEnabled
                ? `Network sharing is currently ON at ${uploadServerStatus.networkUrl}. Devices on that network can view, upload, download, and delete files over unencrypted HTTP. Stop the server or restart it without --lan to turn sharing off.`
                : "Network sharing is currently OFF. This computer can still use the local shelf. Turning it on with `python3 server.py --lan` lets devices on your Wi-Fi/LAN view, upload, download, and delete files without a password or encryption.",
            action: openUploads,
        };
    }

    if (/check|valid|okay|correct|work|entered/.test(text) &&
        (/link|url|address/.test(text) || mentionedUrl)
    ) {
        if (!candidateUrl) {
            return {
                message: "I can check whether a link has a supported format, but I can’t contact the remote site to see if the file exists. Paste the link in the Downloader first, or include it in your question.",
                action: openDownloader,
            };
        }
        const validation = validateDirectFileUrl(candidateUrl);
        if (validation.error) {
            return {
                message: `That link does not look supported: ${validation.error} Use a direct HTTP or HTTPS file link, a supported cloud share, or scan a public webpage from the Downloader.`,
                action: { ...openDownloader, url: mentionedUrl },
            };
        }
        const parsedUrl = validation.parsedUrl;
        const suggestedName = safeFilename(filenameInput.value) ||
            suggestedFilename(parsedUrl, validation.provider);
        return {
            message: validation.provider
                ? `${validation.provider} shared links are supported. SurfyFriend would use "${suggestedName}" as the label, but the provider may show a preview or require sign-in.`
                : `The link format is supported and points to ${parsedUrl.hostname}. SurfyFriend would use "${suggestedName}" as the filename. I can’t verify that the remote file exists, that you have access, or that the server will download instead of showing a preview.`,
            action: { ...openDownloader, url: mentionedUrl },
        };
    }

    if (/upload|local file|my file|localhost|shelf/.test(text)) {
        if (/large|size|500 ?mb|limit/.test(text)) {
            return {
                message: "The local shelf accepts files up to 500 MB each. If a file is larger, use the source service's own download/storage options or choose a smaller file. The shelf stores files on the computer running the local server.",
                action: openUploads,
            };
        }
        if (/not working|isnt|doesnt|cant|cannot|failed|error|unavailable|not showing|wont|why|stuck/.test(text)) {
            if (!uploadServerStatus || window.location.protocol !== "http:") {
                return {
                    message: "The upload shelf needs the local server; it won’t work from a file:// page or a separately hosted static copy. In the SurfyFriend project folder, run `python3 server.py`, then open `http://127.0.0.1:8765/` in this browser. If the server is already running, use Refresh on My uploads and check the message shown there.",
                    action: openUploads,
                };
            }
            return {
                message: "The local server is responding. Check that you selected files, that each is 500 MB or smaller, and that the upload progress is moving. If it stopped, refresh My uploads and try again; the status message there should explain any server error.",
                action: openUploads,
            };
        }
        if (/where|folder|stored|save/.test(text)) {
            return {
                message: "Files in My uploads are stored on the computer running SurfyFriend, in `~/.dropzone/uploads`. They remain there after the server stops until you delete them. This is separate from downloads opened from a link, which use your browser’s normal download settings.",
                action: openUploads,
            };
        }
        return {
            message: "My uploads is a private file shelf on the computer running SurfyFriend. Run `python3 server.py` in the project folder and open `http://127.0.0.1:8765/`; choose or drop files, then upload. Each file can be up to 500 MB. Sharing with other devices is optional and has no password, so only enable it on a trusted network.",
            action: openUploads,
        };
    }

    if (/queue|batch|many links|multiple links|next link/.test(text)) {
        const count = downloadQueue.length;
        return {
            message: count
                ? `There ${count === 1 ? "is" : "are"} ${count} ${count === 1 ? "link" : "links"} in your queue right now. You can add up to 50 direct HTTP or HTTPS file links or supported cloud shares (one per line); duplicates are skipped. Open them one at a time with “Open next” or an item’s “Open link” button.`
                : "Your queue is empty right now. Add a file or supported cloud-share link from the Downloader, or paste up to 50 links (one per line) on the queue page. Duplicates are skipped, and links open one at a time.",
            action: { label: "Open Download queue", page: "queue" },
        };
    }

    if (/history|previous|recent/.test(text)) {
        return {
            message: `${downloadHistory.length ? `You have ${downloadHistory.length} saved ${downloadHistory.length === 1 ? "link" : "links"} in this browser` : "There are no links in your history yet"}. History records links you opened, not whether the remote download completed. Use the search box to find a name or address, or Clear history to remove it.`,
            action: { label: "Open Download history", page: "history" },
        };
    }

    if (/achievement|badge|xp|points|level|progress/.test(text)) {
        const earned = unlockedAchievements();
        return {
            message: `You have ${totalExperience()} XP and are a ${document.getElementById("levelName").textContent}. There are ${achievementDefinitions.length} badges to collect. Earn points by opening links, exploring new website addresses (repeat visits earn no XP), adding queue links, scanning webpages, previewing media, or saving files to your local shelf. Badges add bonus XP. “Opened” means SurfyFriend opened the link; it cannot tell whether the file finished downloading. ${earned.length ? `Badges earned: ${earned.map((item) => item.title).join(", ")}.` : "Keep exploring to unlock your first badge."}`,
            action: { label: "View achievements", page: "achievements" },
        };
    }

    if (/website explorer|explore (a |the )?website|visit (a |the )?website/.test(text)) {
        return {
            message: `Enter a website address on Website Explorer to open it in a new tab. You have explored ${progress.websiteVisits} unique ${progress.websiteVisits === 1 ? "website" : "websites"} on this device so far. Each normalized address earns XP only once; revisiting it will not earn more. SurfyFriend accepts http:// and https:// addresses and does not verify the destination.`,
            action: { label: "Open Website Explorer", page: "explorer" },
        };
    }

    if (/where.*download|download.*where|save location|saved to|downloads folder/.test(text)) {
        return {
            message: "SurfyFriend opens the link; your browser decides where downloaded files go. Check your browser’s Downloads list or download settings to find or change that folder. SurfyFriend’s history only remembers the link—it can’t confirm that a file finished downloading.",
        };
    }

    if (/opens? (a |the )?(web)?page|preview|tab|access denied|download failed|failed download|404|403|server error|expired link|permission|(?:not|isnt|doesnt|wont|fail|error|blocked|stuck|expired|403|404).{0,30}(?:download|downloads|link|file)|(?:download|downloads|link|file).{0,30}(?:not|isnt|doesnt|wont|fail|error|blocked|stuck|expired|403|404)/.test(text)) {
        return {
            message: "First check whether the address goes straight to a file rather than to a webpage with a Download button. A 403/404, sign-in page, or expired link usually needs a fresh link or permission from the source site. Some sites block direct links or show a preview instead. SurfyFriend cannot bypass those rules or confirm a download completed; try the site’s own download button and check your browser’s Downloads list.",
            action: openDownloader,
        };
    }

    if (/rename|filename|file name/.test(text)) {
        return {
            message: "In the Downloader, enter a name in “Save as”. Leave it blank to use the filename from the link. The source site may ignore the suggested name for cross-site links, so check the browser’s download prompt or Downloads list.",
            action: openDownloader,
        };
    }

    if (/copy|paste|clipboard/.test(text)) {
        return {
            message: "Copy the full file address from the source page, then use Paste beside the File URL field. If the browser blocks clipboard access, click the field and paste with your usual keyboard shortcut (⌘V on Mac, Ctrl+V on Windows).",
            action: openDownloader,
        };
    }

    if (/search|find/.test(text) && /website|web|internet|online/.test(text)) {
        return {
            message: "SurfyFriend doesn’t search the web. The search box filters your saved download history. To find files on a public webpage, use Find downloadable links in the Downloader (if the site allows browser access); otherwise copy a direct file link or supported cloud share.",
            action: openDownloader,
        };
    }

    if (/theme|dark|light|appearance/.test(text)) {
        return {
            message: "Use the moon or sun button in the top bar to switch themes, or choose Light or Dark in Settings. Your choice is saved in this browser.",
            action: { label: "Open Settings", page: "settings" },
        };
    }

    if (/download|direct link|url|file link|link/.test(text)) {
        return {
            message: "Paste a direct file link or supported Google Drive, Dropbox, or OneDrive share into the Downloader. For a public webpage, use Find downloadable links; it works only when the site allows browser access. You can also paste several links on the Download queue page. The source still controls access and whether a link downloads or previews.",
            action: openDownloader,
        };
    }

    return {
        message: "I can give step-by-step help with link formats, downloads that open a webpage, filenames, the queue, browser download locations, local uploads, and privacy. Tell me what you tried and what happened; I can use the link already entered to give more specific guidance.",
    };
}

function sendHelperQuestion(question) {
    if (!accountUsername) {
        return;
    }
    const prompt = question.trim();
    if (!prompt) {
        return;
    }
    addHelperMessage(prompt, "user");
    const reply = getHelperReply(prompt);
    addHelperMessage(reply.message, "assistant", reply.action);
}

document.getElementById("helperForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendHelperQuestion(helperInput.value);
    helperInput.value = "";
    helperInput.focus();
});
document.querySelectorAll("[data-helper-prompt]").forEach((button) => {
    button.addEventListener("click", () => sendHelperQuestion(button.dataset.helperPrompt));
});

updateLinkHint();
renderProgress();
renderSuggestedSites();
renderExplorerHistory();
initializeFullVersionStatus();
initializeAccountService();
initializeWebsiteChecker();
const connectedGamepad = Array.from(navigator.getGamepads?.() || [])
    .find((gamepad) => gamepad?.connected);
if (connectedGamepad) {
    startGamepadPolling(connectedGamepad);
}
if (!["http:", "https:"].includes(window.location.protocol)) {
    const puterButton = document.getElementById("getPuterSuggestions");
    puterButton.disabled = true;
    puterButton.title = "Open SurfyFriend from a local or hosted web address to use Puter AI.";
    document.getElementById("puterSuggestionStatus").textContent = puterOriginMessage();
}
showPage(window.location.hash.slice(1) || "home", false, false);
renderHistory();
renderQueue();
