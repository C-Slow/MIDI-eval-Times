import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

const webStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
};

const getSecureItem = async (key: string): Promise<string | null> => {
  if (isWeb) {
    return webStorage.getItem(key);
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch (e) {
    console.warn(`SecureStore.getItemAsync failed for key ${key}:`, e);
    return null;
  }
};

const setSecureItem = async (key: string, value: string): Promise<void> => {
  if (isWeb) {
    webStorage.setItem(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (e) {
    console.warn(`SecureStore.setItemAsync failed for key ${key}:`, e);
  }
};

const deleteSecureItem = async (key: string): Promise<void> => {
  if (isWeb) {
    webStorage.removeItem(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (e) {
    console.warn(`SecureStore.deleteItemAsync failed for key ${key}:`, e);
  }
};

const getDefaultServerUrl = (): string => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  const debuggerHost = Constants.expoConfig?.hostUri;
  if (debuggerHost) {
    const ip = debuggerHost.split(':')[0];
    return `http://${ip}:8000`;
  }
  return 'http://localhost:8000';
};


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
    original_name?: string;
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

  backendAudioEnabled: boolean;
  backendAudioVolume: number;
  selectedDevice: string;

  // Piano State (Hardware)
  pianoPlayback: {
    isPlaying: boolean;
    file: string | null;
    elapsed: number;
    length: number;
    type: 'single' | 'queue' | null;
    backend_audio_enabled?: boolean;
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
  setBackendAudioEnabled: (enabled: boolean) => void;
  setBackendAudioVolume: (volume: number) => void;
  setSelectedDevice: (device: string) => void;
  
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
  serverUrl: getDefaultServerUrl(),
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

  backendAudioEnabled: false,
  backendAudioVolume: 1.0,
  selectedDevice: '',

  pianoPlayback: {
    isPlaying: false,
    file: null,
    elapsed: 0,
    length: 0,
    type: null,
    backend_audio_enabled: false,
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
    setSecureItem('midiOrchestrateOffset', String(midiOrchestrateOffset));
  },

  setServerUrl: (serverUrl) => {
    set({ serverUrl });
    setSecureItem('serverUrl', serverUrl);
  },
  setToken: (token) => {
    set({ token });
    if (token) {
      setSecureItem('token', token);
    } else {
      deleteSecureItem('token');
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
    setSecureItem('theme', theme);
  },
  setCurrentTab: (currentTab) => set({ currentTab }),
  setBackendAudioEnabled: (backendAudioEnabled) => set({ backendAudioEnabled }),
  setBackendAudioVolume: (backendAudioVolume) => set({ backendAudioVolume }),
  setSelectedDevice: (selectedDevice) => set({ selectedDevice }),

  initialize: async () => {
    try {
      const serverUrl = await getSecureItem('serverUrl');
      const token = await getSecureItem('token');
      const theme = await getSecureItem('theme') as 'light' | 'dark' | null;
      const midiOrchestrateOffset = await getSecureItem('midiOrchestrateOffset');
      if (serverUrl) set({ serverUrl });
      if (token && token !== 'null' && token !== 'undefined') {
        set({ token, isLoggedIn: true });
      } else {
        set({ token: null, isLoggedIn: false });
      }
      if (theme) set({ theme });
      if (midiOrchestrateOffset) set({ midiOrchestrateOffset: parseInt(midiOrchestrateOffset, 10) || 0 });
    } catch (e) {
      console.warn('Failed to load secure store items:', e);
    }

    try {
      const { midiOrchestratorApi } = require('../services/api');
      const settings = await midiOrchestratorApi.getAudioSettings();
      set({ 
        backendAudioEnabled: settings.backend_audio_enabled ?? false,
        backendAudioVolume: settings.backend_audio_volume ?? 1.0,
        selectedDevice: settings.selected_device ?? ''
      });
    } catch (e) {}
  },

  logout: async () => {
    await deleteSecureItem('token');
    set({ token: null, isLoggedIn: false });
  }
}));
