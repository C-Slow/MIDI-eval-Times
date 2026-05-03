import axios from 'axios';
import { useStore } from '../store/useStore';

const getBaseUrl = () => useStore.getState().serverUrl;
const getToken = () => useStore.getState().token;

const api = axios.create({
  timeout: 120000, // 120 seconds (2 minutes)
});

// Simple retry logic for intermittent network errors
api.interceptors.response.use(undefined, (err) => {
  const { config, message } = err;
  if (!config || !config.retry) return Promise.reject(err);
  
  if (message === 'Network Error') {
    config.retry -= 1;
    console.log(`Retrying request... (${config.retry} left)`);
    const delayRetry = new Promise((resolve) => {
      setTimeout(() => resolve(true), 1000);
    });
    return delayRetry.then(() => api(config));
  }
  return Promise.reject(err);
});

api.interceptors.request.use((config) => {
  const url = getBaseUrl();
  const token = getToken();
  
  config.baseURL = url;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  console.log(`[API] ${config.method?.toUpperCase()} ${url}${config.url}`);
  return config;
});

export const authApi = {
  login: async (password: string) => {
    const res = await api.post('/login', { password });
    return res.data;
  },
};

export const fileApi = {
  listFiles: async () => {
    const res = await api.get('/files');
    return res.data;
  },
  getUniqueMetadata: async () => {
    const res = await api.get('/files/metadata/unique');
    return res.data;
  },
  downloadUrl: (filename: string) => {
    const token = getToken();
    return `${getBaseUrl()}/files/download/${encodeURIComponent(filename)}?token=${encodeURIComponent(token || '')}`;
  },
  deleteFile: async (filename: string) => {
    const res = await api.post('/files/delete', { filename });
    return res.data;
  },
  renameFile: async (old: string, newName: string) => {
    const res = await api.post('/files/rename_json', { old, new: newName });
    return res.data;
  },
};

export const processApi = {
  clean: async (filename: string, profile: string = 'balanced', rhythm_factor: number = 1.0, melody_factor: number = 1.0) => {
    const res = await api.post('/process/clean', { 
      filename, 
      profile,
      rhythm_factor,
      melody_factor
    });
    return res.data;
  },
  tempo: async (filename: string, factor: number) => {
    const res = await api.post('/process/tempo', { filename, factor });
    return res.data;
  },
};

export const playlistApi = {
  listPlaylists: async () => {
    const res = await api.get('/playlists');
    return res.data;
  },
  createPlaylist: async (name: string) => {
    const res = await api.post('/playlists', { name });
    return res.data;
  },
  deletePlaylist: async (name: string) => {
    const res = await api.post(`/playlists/delete?name=${encodeURIComponent(name)}`);
    return res.data;
  },
  addBulk: async (name: string, filenames: string[]) => {
    const res = await api.post(`/playlists/add_bulk?name=${encodeURIComponent(name)}`, { filenames });
    return res.data;
  },
  removeBulk: async (name: string, filenames: string[]) => {
    const res = await api.post(`/playlists/remove_bulk?name=${encodeURIComponent(name)}`, { filenames });
    return res.data;
  },
  createSmartPlaylist: async (name: string, filterType: string, filterValue: string, excludeDnu: boolean = true) => {
    const res = await api.post('/playlists/smart', { name, filter_type: filterType, filter_value: filterValue, exclude_dnu: excludeDnu });
    return res.data;
  },
  getPlaylistRules: async () => {
    const res = await api.get('/playlists/rules');
    return res.data;
  },
  refreshAllSmartPlaylists: async () => {
    const res = await api.post('/playlists/smart/refresh_all');
    return res.data;
  },
  playPlaylist: async (name: string, options: { shuffle?: boolean, repeat?: boolean, port_name?: string } = {}) => {
    const res = await api.post(`/playlists/play?name=${encodeURIComponent(name)}`, options);
    return res.data;
  },
};

export const pianoApi = {
  sendToDisk: async (filename: string, port_name?: string) => {
    const res = await api.post('/play', { filename, port_name });
    return res.data;
  },
  stop: async () => {
    await Promise.all([
      api.post('/play/stop'),
      api.post('/queue/stop'),
    ]);
  },
  next: async () => {
    const res = await api.post('/queue/next');
    return res.data;
  },
  getQueueStatus: async () => {
    const res = await api.get('/queue/status');
    return res.data;
  },
  getPlaybackStatus: async () => {
    const res = await api.get('/playback/status');
    return res.data;
  },
};

export const midiApi = {
  getStatus: async () => {
    const res = await api.get('/midi/status');
    return res.data;
  },
  scan: async () => {
    const res = await api.get('/midi/scan');
    return res.data;
  },
  connect: async (target_device: string) => {
    const res = await api.post('/midi/connect', { target_device });
    return res.data;
  },
};

export const settingsApi = {
  getSettings: async () => {
    const res = await api.get('/settings');
    return res.data;
  },
  saveSettings: async (settings: any) => {
    const res = await api.post('/settings', settings);
    return res.data;
  },
  // Update metadata for a file (DNU, comments, etc)
  saveMetadata: async (filename: string, metadata: any) => {
    const res = await api.post(`/files/metadata/${encodeURIComponent(filename)}`, metadata);
    return res.data;
  },
  saveMetadataBulk: async (filenames: string[], metadata: any) => {
    const res = await api.post('/files/metadata_bulk', { filenames, metadata });
    return res.data;
  },
  getGeminiKey: async () => {
    const res = await api.get('/settings/gemini_key');
    return res.data;
  },
  saveGeminiKey: async (key: string) => {
    const res = await api.post('/settings/gemini_key', { key });
    return res.data;
  }
};

export const voiceApi = {
  sendAudio: async (uri: string) => {
    const formData = new FormData();
    // @ts-ignore
    formData.append('audio', {
      uri,
      name: 'voice_command.m4a',
      type: 'audio/m4a'
    });
    const res = await api.post('/voice/audio', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return res.data;
  }
};

export const mp3Api = {
  upload: async (filename: string, base64Data: string, routeMode: string = 'piano', engine: string = 'bytedance', sensitivity: number = 1.0, includeOther: boolean = false) => {
    const res = await api.post('/mp3/upload_base64', { 
      filename, 
      data: base64Data, 
      route_mode: routeMode, 
      engine: engine, 
      engine_sensitivity: sensitivity,
      include_other: includeOther
    });
    return res.data;
  },
  getStatus: async (jobId: string) => {
    const res = await api.get(`/mp3/status/${jobId}`);
    return res.data;
  },
  listJobs: async () => {
    const res = await api.get('/mp3/jobs');
    return res.data;
  },
  getVocalsUrl: (jobId: string) => {
    const token = getToken();
    return `${getBaseUrl()}/mp3/vocals/${jobId}?token=${encodeURIComponent(token || '')}`;
  },
  getPianoRenderUrl: (jobId: string) => {
    const token = getToken();
    return `${getBaseUrl()}/mp3/render/${jobId}?token=${encodeURIComponent(token || '')}`;
  },
  playMidi: async (jobId: string) => {
    const res = await api.post(`/mp3/play/${jobId}`);
    return res.data;
  },
  updateSettings: async (jobId: string, updates: any) => {
    const res = await api.post(`/mp3/settings/${jobId}`, updates);
    return res.data;
  },
  deleteJob: async (jobId: string) => {
    const res = await api.delete(`/mp3/job/${jobId}`);
    return res.data;
  },
  mergeJobs: async (midiJobId: string, audioJobId: string) => {
    const res = await api.post('/mp3/merge_jobs', { midi_job_id: midiJobId, audio_job_id: audioJobId });
    return res.data;
  },
  autoSync: async (uri: string) => {
    const formData = new FormData();
    // @ts-ignore
    formData.append('file', {
      uri,
      name: 'recording.wav',
      type: 'audio/wav'
    });
    const res = await api.post('/mp3/auto_sync', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return res.data;
  },
  replaceMidi: async (jobId: string, uri: string) => {
    const formData = new FormData();
    // @ts-ignore
    formData.append('file', {
      uri,
      name: 'replacement.mid',
      type: 'audio/midi'
    });
    const res = await api.post(`/mp3/replace_midi/${jobId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return res.data;
  },
  replaceMidiExisting: async (jobId: string, filename: string) => {
    const res = await api.post(`/mp3/replace_midi_existing/${jobId}?filename=${encodeURIComponent(filename)}`);
    return res.data;
  }
};

export const systemApi = {
  createBackup: async () => {
    const res = await api.post('/system/backup');
    return res.data;
  }
};

export default api;
