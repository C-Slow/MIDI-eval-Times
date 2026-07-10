import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface FileInfo {
  name: string;
  length?: number;
  size?: number;
  created?: number;
  metadata?: {
    clean_profile?: string;
    tempo_factor?: number;
    rhythm_factor?: number;
    melody_factor?: number;
    dnu?: boolean;
    comments?: string;
    rating?: number;
    artist?: string;
    genre?: string;
    mood?: string;
    source?: string;
    is_game_or_movie?: boolean;
    gemini_analysis?: any;
  };
}

interface AppState {
  serverUrl: string;
  token: string | null;
  files: { raw: FileInfo[]; processed: FileInfo[] };
  uniqueMetadata: { artist: string[], genre: string[], mood: string[], source: string[] };
  playlists: Record<string, { tracks: string[], color: string }>;
  isLoggedIn: boolean;
  isUploading: boolean;
  isPollingMuted: boolean;
  isSystemBusy: boolean;
  theme: 'light' | 'dark';
  currentTab: string;
  
  // Piano Connection
  isPianoConnected: boolean;
  targetDevice: string;
  
  // Audio State (Phone/Local)
  localPlayback: {
    isPlaying: boolean;
    isLoading: boolean;
    currentFile: string | null;
    position: number;
    duration: number;
  };

  // Piano State (Hardware)
  pianoPlayback: {
    isPlaying: boolean;
    file: string | null;
    elapsed: number;
    length: number;
    type: 'single' | 'queue' | null;
  };
  
  // Actions
  setServerUrl: (url: string) => void;
  setToken: (token: string | null) => void;
  setFiles: (files: { raw: FileInfo[]; processed: FileInfo[] }) => void;
  setUniqueMetadata: (uniqueMetadata: { artist: string[], genre: string[], mood: string[], source: string[] }) => void;
  setPlaylists: (playlists: Record<string, { tracks: string[], color: string }>) => void;
  setLoggedIn: (loggedIn: boolean) => void;
  setUploading: (isUploading: boolean) => void;
  setPollingMuted: (muted: boolean) => void;
  setSystemBusy: (isBusy: boolean) => void;
  setLocalPlayback: (playback: Partial<AppState['localPlayback']>) => void;
  setPianoPlayback: (playback: Partial<AppState['pianoPlayback']>) => void;
  setPianoStatus: (connected: boolean, target: string) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setCurrentTab: (tab: string) => void;
  
  // Global Clean Modal
  cleanModal: {
    visible: boolean,
    filenames: string[],
    rhythm: number,
    melody: number,
    profile: string
  };
  setCleanModal: (config: Partial<AppState['cleanModal']>) => void;

  initialize: () => Promise<void>;
  logout: () => Promise<void>;
  
  // Simplified Trigger for Notifications
  stopAll: () => void; // Will be set by useAudioPlayer
  setStopTrigger: (fn: () => void) => void;

  midiOrchestrateOffset: number;
  setMidiOrchestrateOffset: (offset: number) => void;
}

export const useStore = create<AppState>((set) => ({
  serverUrl: 'http://192.168.1.19:8000',
  token: null,
  files: { raw: [], processed: [] },
  uniqueMetadata: { artist: [], genre: [], mood: [], source: [] },
  playlists: {},
  isLoggedIn: false,
  isUploading: false,
  isPollingMuted: false,
  isSystemBusy: false,
  theme: 'light',
  currentTab: 'FilesTab',
  
  isPianoConnected: false,
  targetDevice: 'MD-BT01',
  
  localPlayback: {
    isPlaying: false,
    isLoading: false,
    currentFile: null,
    position: 0,
    duration: 0,
  },

  pianoPlayback: {
    isPlaying: false,
    file: null,
    elapsed: 0,
    length: 0,
    type: null,
  },

  cleanModal: {
    visible: false,
    filenames: [],
    rhythm: 1.0,
    melody: 1.0,
    profile: 'light'
  },
  setCleanModal: (update) => set((state) => ({ cleanModal: { ...state.cleanModal, ...update } })),

  stopAll: () => {},
  setStopTrigger: (stopAll) => set({ stopAll }),

  midiOrchestrateOffset: 0,
  setMidiOrchestrateOffset: (midiOrchestrateOffset) => {
    set({ midiOrchestrateOffset });
    SecureStore.setItemAsync('midiOrchestrateOffset', String(midiOrchestrateOffset));
  },

  setServerUrl: (serverUrl) => {
    set({ serverUrl });
    SecureStore.setItemAsync('serverUrl', serverUrl);
  },
  setToken: (token) => {
    set({ token });
    if (token) {
      SecureStore.setItemAsync('token', token);
    } else {
      SecureStore.deleteItemAsync('token');
    }
  },
  setFiles: (files) => set({ files }),
  setUniqueMetadata: (uniqueMetadata) => set({ uniqueMetadata }),
  setPlaylists: (playlists) => set({ playlists }),
  setLoggedIn: (isLoggedIn) => set({ isLoggedIn }),
  setUploading: (isUploading) => set({ isUploading }),
  setPollingMuted: (isPollingMuted) => set({ isPollingMuted }),
  setSystemBusy: (isSystemBusy) => set({ isSystemBusy }),
  setLocalPlayback: (update) => set((state) => ({ localPlayback: { ...state.localPlayback, ...update } })),
  setPianoPlayback: (update) => set((state) => ({ pianoPlayback: { ...state.pianoPlayback, ...update } })),
  setPianoStatus: (isPianoConnected, targetDevice) => set({ isPianoConnected, targetDevice }),
  setTheme: (theme) => {
    set({ theme });
    SecureStore.setItemAsync('theme', theme);
  },
  setCurrentTab: (currentTab) => set({ currentTab }),

  initialize: async () => {
    const serverUrl = await SecureStore.getItemAsync('serverUrl');
    const token = await SecureStore.getItemAsync('token');
    const theme = await SecureStore.getItemAsync('theme') as 'light' | 'dark' | null;
    const midiOrchestrateOffset = await SecureStore.getItemAsync('midiOrchestrateOffset');
    if (serverUrl) set({ serverUrl });
    if (token && token !== 'null' && token !== 'undefined') {
      set({ token, isLoggedIn: true });
    } else {
      set({ token: null, isLoggedIn: false });
    }
    if (theme) set({ theme });
    if (midiOrchestrateOffset) set({ midiOrchestrateOffset: parseInt(midiOrchestrateOffset, 10) || 0 });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('token');
    set({ token: null, isLoggedIn: false });
  }
}));
