import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ActivityIndicator, 
  FlatList, 
  Alert, 
  ScrollView, 
  Dimensions,
  TextInput,
  InteractionManager,
  Modal,
  Platform,
  KeyboardAvoidingView,
  Switch
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { useStore } from '../store/useStore';
import { midiOrchestratorApi, pianoApi } from '../services/api';
import { Colors } from '../constants/Colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PIXELS_PER_SECOND = 40; // Timeline scale
const LANE_HEIGHT = 80;

interface NoteGridProps {
  lanesData: any[];
  pianoTracks: Set<number>;
  speakerTracks: Set<number>;
  themeColors: any;
  durationSec: number;
  timelineWidth: number;
  totalHeight: number;
}

const NoteGrid = React.memo(({
  lanesData,
  pianoTracks,
  speakerTracks,
  themeColors,
  durationSec,
  timelineWidth,
  totalHeight,
}: NoteGridProps) => {
  const getTrackColor = (trackIndex: number, isPiano: boolean, isSpeaker: boolean) => {
    if (isPiano) return themeColors.accent; // Vibrant Blue/Cyan
    if (isSpeaker) return '#a29bfe'; // Light purple for strings/speakers
    return themeColors.textMuted;
  };

  const verticalPadding = 8;
  const usableLaneHeight = LANE_HEIGHT - (verticalPadding * 2);

  return (
    <View style={{ width: timelineWidth, height: totalHeight, position: 'absolute', top: 0, left: 0 }}>
      {/* Consolidated parent vertical grid lines */}
      {Array.from({ length: Math.ceil(durationSec / 5) }).map((_, i) => (
        <View 
          key={`grid-${i}`} 
          style={[
            styles.gridLine, 
            { 
              left: i * 5 * PIXELS_PER_SECOND, 
              borderColor: themeColors.border, 
              height: totalHeight 
            }
          ]} 
        />
      ))}

      {lanesData.map((lane: any, laneIdx: number) => {
        const isPiano = pianoTracks.has(lane.index);
        const isSpeaker = speakerTracks.has(lane.index);
        const color = getTrackColor(lane.index, isPiano, isSpeaker);

        return (
          <View 
            key={lane.index} 
            style={[
              styles.laneTimeline, 
              { 
                height: LANE_HEIGHT, 
                top: laneIdx * LANE_HEIGHT, 
                borderBottomColor: themeColors.border 
              }
            ]}
          >
            {/* Note Blocks */}
            {lane.notes.map((note: any, noteIdx: number) => {
              const noteWidth = Math.max(2, (note.end - note.start) * PIXELS_PER_SECOND);
              const noteLeft = note.start * PIXELS_PER_SECOND;
              const normalizedPitch = (note.pitch - lane.minPitch) / lane.pitchRange;
              const noteTop = verticalPadding + (usableLaneHeight * (1 - normalizedPitch));

              return (
                <View
                  key={noteIdx}
                  style={[
                    styles.note,
                    {
                      left: noteLeft,
                      width: noteWidth,
                      top: noteTop,
                      height: 4,
                      backgroundColor: color,
                    }
                  ]}
                />
              );
            })}
          </View>
        );
      })}
    </View>
  );
}, (prevProps, nextProps) => {
  if (prevProps.timelineWidth !== nextProps.timelineWidth) return false;
  if (prevProps.totalHeight !== nextProps.totalHeight) return false;
  if (prevProps.durationSec !== nextProps.durationSec) return false;
  if (prevProps.themeColors !== nextProps.themeColors) return false;
  if (prevProps.lanesData !== nextProps.lanesData) return false;
  
  if (prevProps.pianoTracks.size !== nextProps.pianoTracks.size) return false;
  if (prevProps.speakerTracks.size !== nextProps.speakerTracks.size) return false;
  
  for (const item of prevProps.pianoTracks) {
    if (!nextProps.pianoTracks.has(item)) return false;
  }
  for (const item of prevProps.speakerTracks) {
    if (!nextProps.speakerTracks.has(item)) return false;
  }
  
  return true;
});

export const MidiEditorScreen = () => {
  const theme = useStore(state => state.theme);
  const themeColors = Colors[theme];
  const isPianoConnected = useStore(state => state.isPianoConnected);
  const globalOffset = useStore(state => state.midiOrchestrateOffset);
  const setGlobalOffset = useStore(state => state.setMidiOrchestrateOffset);
  const setSystemBusy = useStore(state => state.setSystemBusy);

  // Screen Stages: 'list' | 'visualizer'
  const [stage, setStage] = useState<'list' | 'visualizer'>('list');
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  
  // Track configuration state
  const [pianoTracks, setPianoTracks] = useState<Set<number>>(new Set());
  const [speakerTracks, setSpeakerTracks] = useState<Set<number>>(new Set());
  const [pedalPreset, setPedalPreset] = useState<'light' | 'medium' | 'full'>('light');
  const [rhythmFactor, setRhythmFactor] = useState(1.0);
  const [melodyFactor, setMelodyFactor] = useState(1.0);

  // Settings Panel visibility
  const [showSettings, setShowSettings] = useState(false);

  // Playback / Visualizer State
  const [notes, setNotes] = useState<Record<string, any[]>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPos, setPlaybackPos] = useState(0); // in ms
  const [playbackDuration, setPlaybackDuration] = useState(0); // in ms
  const soundRef = useRef<Audio.Sound | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const playbackTimerRef = useRef<any>(null);
  const isSeekingRef = useRef(false);

  // Preview State
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  // Context Actions Bottom Sheet & Modals State
  const [contextJob, setContextJob] = useState<any | null>(null);
  const [recleanVisible, setRecleanVisible] = useState(false);
  const [recleanRhythm, setRecleanRhythm] = useState(1.0);
  const [recleanMelody, setRecleanMelody] = useState(1.0);
  const [recleanPedal, setRecleanPedal] = useState<'light' | 'medium' | 'full'>('light');

  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailsTitle, setDetailsTitle] = useState('');
  const [detailsArtist, setDetailsArtist] = useState('');
  const [detailsComments, setDetailsComments] = useState('');
  const [detailsRating, setDetailsRating] = useState(0);
  const [detailsGenre, setDetailsGenre] = useState('');
  const [detailsMood, setDetailsMood] = useState('');
  const [detailsSource, setDetailsSource] = useState('');
  const [detailsDnu, setDetailsDnu] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const previewSoundRef = useRef<Audio.Sound | null>(null);

  const toggleSelect = (jobId: string) => {
    setSelectedJobs(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const clearSelection = () => setSelectedJobs(new Set());

  const getCleanTitle = (filename: string) => {
    if (!filename) return '';
    return filename.replace(/\.midi?$/i, '');
  };

  const getSongLength = (item: any) => {
    if (!item.tracks || item.tracks.length === 0) return '';
    const maxDuration = Math.max(...item.tracks.map((t: any) => t.duration || 0));
    if (maxDuration <= 0) return '';
    const mins = Math.floor(maxDuration / 60);
    const secs = Math.floor(maxDuration % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const renderStars = (count: number) => {
    if (!count || count <= 0) return null;
    return (
      <View style={{ flexDirection: 'row', marginLeft: 6 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <Ionicons 
            key={i} 
            name={i <= count ? "star" : "star-outline"} 
            size={10} 
            color={i <= count ? "#FFD700" : themeColors.textMuted} 
          />
        ))}
      </View>
    );
  };

  // Selected job details
  const currentJob = useMemo(() => {
    return jobs.find(j => j.job_id === selectedJobId) || null;
  }, [jobs, selectedJobId]);

  const hasChanges = useMemo(() => {
    if (!currentJob) return false;
    const savedPiano = new Set(currentJob.piano_tracks || []);
    const savedSpeaker = new Set(currentJob.speaker_tracks || []);
    
    if (pianoTracks.size !== savedPiano.size) return true;
    if (speakerTracks.size !== savedSpeaker.size) return true;
    
    for (const id of pianoTracks) {
      if (!savedPiano.has(id)) return true;
    }
    for (const id of speakerTracks) {
      if (!savedSpeaker.has(id)) return true;
    }
    
    if (pedalPreset !== currentJob.pedal_preset) return true;
    if (rhythmFactor !== currentJob.rhythm_factor) return true;
    if (melodyFactor !== currentJob.melody_factor) return true;
    
    return false;
  }, [currentJob, pianoTracks, speakerTracks, pedalPreset, rhythmFactor, melodyFactor]);

  const openUnifiedWorkspace = async (jobId: string) => {
    const job = jobs.find(j => j.job_id === jobId);
    if (!job) return;

    setSelectedJobId(jobId);
    setPianoTracks(new Set(job.piano_tracks || []));
    setSpeakerTracks(new Set(job.speaker_tracks || []));
    setPedalPreset(job.pedal_preset || 'light');
    setRhythmFactor(job.rhythm_factor ?? 1.0);
    setMelodyFactor(job.melody_factor ?? 1.0);

    setLoading(true);
    try {
      // 1. Fetch note events for the lanes
      const noteData = await midiOrchestratorApi.getNotes(jobId);
      setNotes(noteData);

      // 2. Clear old sound refs
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      if (previewSoundRef.current) {
        await previewSoundRef.current.unloadAsync();
        previewSoundRef.current = null;
      }

      // 3. If job is completed, pre-load backing audio for performance play
      if (job.status === 'completed') {
        const url = midiOrchestratorApi.getBackingAudioUrl(jobId);
        const { sound } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: false, progressUpdateIntervalMillis: 100 },
          onPlaybackStatusUpdate
        );
        soundRef.current = sound;
      }

      setStage('visualizer');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Workspace Error', 'Failed to load visualizer workspace.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTrackRole = (trackIndex: number, role: 'piano' | 'speakers' | 'mute') => {
    if (isPreviewPlaying) {
      stopPreview();
    }
    if (isPlaying) {
      stopPlayback();
    }

    setPianoTracks(prev => {
      const next = new Set(prev);
      if (role === 'piano') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });

    setSpeakerTracks(prev => {
      const next = new Set(prev);
      if (role === 'speakers') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
  };

  // Load jobs list
  const fetchJobs = async () => {
    try {
      const data = await midiOrchestratorApi.listJobs();
      setJobs(data);
    } catch (e) {
      console.error('Failed to load midi jobs', e);
    }
  };

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setLoading(true);
      fetchJobs().finally(() => setLoading(false));
    });
    return () => {
      task.cancel();
      stopPlayback();
      stopPreview();
    };
  }, []);

  // Poll job status if any is processing
  useEffect(() => {
    const hasProcessing = jobs.some(j => j.status === 'processing' || j.status === 'synthesizing');
    let timer: any;
    if (hasProcessing) {
      timer = setInterval(fetchJobs, 2000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [jobs]);

  // Handle MIDI Upload
  const handleUpload = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['audio/midi', 'audio/x-midi', 'audio/mid', '*/*'],
        copyToCacheDirectory: true
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;

      const asset = res.assets[0];
      if (!asset.name.toLowerCase().endsWith('.mid') && !asset.name.toLowerCase().endsWith('.midi')) {
        Alert.alert('Invalid File', 'Please choose a standard MIDI (.mid or .midi) file.');
        return;
      }

      setLoading(true);
      const data = await midiOrchestratorApi.upload(asset.uri, asset.name);
      await fetchJobs();
      Alert.alert('Upload Success', 'MIDI track extracted. Select it to configure track allocation.');
      
      // Auto-open workspace stage for the newly uploaded job
      await openUnifiedWorkspace(data.job_id);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Upload Failed', e.message || 'Could not upload MIDI file.');
    } finally {
      setLoading(false);
    }
  };
 
  // Open job in workspace
  const handleJobSelect = (job: any) => {
    if (job.status === 'processing' || job.status === 'synthesizing') {
      Alert.alert('Processing', 'This file is currently being processed. Please wait...');
      return;
    }
    openUnifiedWorkspace(job.job_id);
  };

  // Delete Job
  const handleDeleteJob = async (jobId: string) => {
    Alert.alert(
      'Delete Job',
      'Are you sure you want to delete this MIDI Orchestration job?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await midiOrchestratorApi.deleteJob(jobId);
              setSelectedJobs(prev => {
                const next = new Set(prev);
                next.delete(jobId);
                return next;
              });
              await fetchJobs();
            } catch (e) {
              console.error(e);
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const handleBulkDelete = () => {
    if (selectedJobs.size === 0) return;
    Alert.alert(
      'Bulk Delete',
      `Delete ${selectedJobs.size} MIDI Orchestration jobs?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              const list = Array.from(selectedJobs);
              for (const id of list) {
                await midiOrchestratorApi.deleteJob(id);
              }
              setSelectedJobs(new Set());
              await fetchJobs();
            } catch (e) {
              console.error(e);
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  // Context Actions Handlers
  const handleOpenContextActions = (job: any) => {
    setContextJob(job);
  };

  const handleCloseContextActions = () => {
    setContextJob(null);
  };

  const handleOpenReclean = (job: any) => {
    setContextJob(job);
    setRecleanRhythm(job.rhythm_factor || 1.0);
    setRecleanMelody(job.melody_factor || 1.0);
    setRecleanPedal(job.pedal_preset || 'light');
    setRecleanVisible(true);
  };

  const handleRunQuickReclean = async () => {
    if (!contextJob) return;
    try {
      setSystemBusy(true);
      setRecleanVisible(false);
      
      await midiOrchestratorApi.process(
        contextJob.job_id,
        contextJob.piano_tracks || [],
        contextJob.speaker_tracks || [],
        recleanPedal,
        recleanRhythm,
        recleanMelody
      );
      
      Alert.alert('Processing Started', 'The MIDI job is being re-synthesized in the background.');
      fetchJobs();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e.message || 'Failed to start processing.');
    } finally {
      setSystemBusy(false);
      setContextJob(null);
    }
  };

  const handleOpenDetails = async (job: any) => {
    try {
      setSystemBusy(true);
      const meta = await midiOrchestratorApi.getMetadata(job.job_id);
      setContextJob(job);
      const displayTitle = getCleanTitle(meta.filename || job.filename || '');
      setDetailsTitle(displayTitle);
      setDetailsArtist(meta.artist || job.artist || '');
      setDetailsComments(meta.comments || job.comments || '');
      setDetailsRating(meta.rating || job.rating || 0);
      setDetailsGenre(meta.genre || job.genre || '');
      setDetailsMood(meta.mood || job.mood || '');
      setDetailsSource(meta.source || job.source || '');
      setDetailsDnu(meta.dnu || job.dnu || false);
      setDetailsVisible(true);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', 'Failed to fetch job metadata.');
    } finally {
      setSystemBusy(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!contextJob) return;
    try {
      setSystemBusy(true);
      setDetailsVisible(false);

      const oldTitle = getCleanTitle(contextJob.filename || '');
      const newTitle = detailsTitle.trim();
      if (newTitle && newTitle !== oldTitle) {
        const originalExt = (contextJob.filename || '').split('.').pop() || 'mid';
        const finalName = newTitle.endsWith('.' + originalExt) ? newTitle : `${newTitle}.${originalExt}`;
        await midiOrchestratorApi.rename(contextJob.job_id, finalName);
      }

      await midiOrchestratorApi.updateMetadata(contextJob.job_id, {
        artist: detailsArtist.trim(),
        comments: detailsComments.trim(),
        rating: detailsRating,
        genre: detailsGenre.trim(),
        mood: detailsMood.trim(),
        source: detailsSource.trim(),
        dnu: detailsDnu
      });

      Alert.alert('Success', 'Song metadata updated successfully.');
      fetchJobs();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e.message || 'Failed to save metadata.');
    } finally {
      setSystemBusy(false);
      setContextJob(null);
    }
  };

  // Toggle track role
  const handleTrackRoleToggle = (trackIndex: number, role: 'piano' | 'speakers' | 'mute') => {
    setPianoTracks(prev => {
      const next = new Set(prev);
      if (role === 'piano') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
    setSpeakerTracks(prev => {
      const next = new Set(prev);
      if (role === 'speakers') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
  };

  const stopPreview = async () => {
    if (previewSoundRef.current) {
      try {
        await previewSoundRef.current.stopAsync();
        await previewSoundRef.current.unloadAsync();
      } catch (e) {}
      previewSoundRef.current = null;
    }
    setIsPreviewPlaying(false);
    setIsPreviewLoading(false);
  };

  const handleTogglePreview = async () => {
    if (!selectedJobId) return;
    if (pianoTracks.size === 0 && speakerTracks.size === 0) {
      Alert.alert('No Tracks Selected', 'Choose at least one track to preview.');
      return;
    }

    if (isPreviewPlaying) {
      await stopPreview();
      return;
    }

    setIsPreviewLoading(true);
    try {
      if (previewSoundRef.current) {
        await previewSoundRef.current.unloadAsync();
      }

      const url = midiOrchestratorApi.getPreviewUrl(
        selectedJobId, 
        Array.from(pianoTracks), 
        Array.from(speakerTracks)
      );

      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true, progressUpdateIntervalMillis: 100 },
        (status: any) => {
          onPlaybackStatusUpdate(status);
          if (status.didJustFinish) {
            stopPreview();
          }
        }
      );

      previewSoundRef.current = sound;
      setIsPreviewPlaying(true);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Preview Failed', 'Could not generate or play local audio preview.');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Run Backend Split & Synthesize Process
  const handleProcess = async () => {
    if (!selectedJobId) return;
    if (pianoTracks.size === 0 && speakerTracks.size === 0) {
      Alert.alert('No Tracks Selected', 'Choose at least one track for Piano or Speakers.');
      return;
    }

    try {
      setLoading(true);
      await midiOrchestratorApi.process(
        selectedJobId,
        Array.from(pianoTracks),
        Array.from(speakerTracks),
        pedalPreset,
        rhythmFactor,
        melodyFactor
      );
      await fetchJobs();
      setStage('list');
      Alert.alert('Processing Started', 'Extracting piano keys and generating backing strings. Monitor progress in the jobs list.');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Processing Failed', e.message || 'Could not start processing.');
    } finally {
      setLoading(false);
    }
  };

  // Sound Playback Updates
  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setPlaybackPos(status.positionMillis);
      setPlaybackDuration(status.durationMillis || 0);

      // Scroll timeline to playhead
      if (status.isPlaying && !isSeekingRef.current) {
        const sec = status.positionMillis / 1000;
        const scrollX = Math.max(0, (sec * PIXELS_PER_SECOND) - (SCREEN_WIDTH / 3));
        scrollRef.current?.scrollTo({ x: scrollX, animated: false });
      }

      if (status.didJustFinish) {
        stopPlayback();
      }
    }
  };

  // Sync Playback Controllers
  const startPlayback = async () => {
    if (!soundRef.current || !selectedJobId) {
      Alert.alert('Playback Error', 'Backing audio is not loaded or ready.');
      return;
    }

    try {
      setSystemBusy(true);
      setIsPlaying(true);

      const playPianoMidi = async () => {
        if (isPianoConnected && pianoTracks.size > 0) {
          try {
            await midiOrchestratorApi.playMidi(selectedJobId);
          } catch (e: any) {
            console.error('Disklavier play failed', e);
            const msg = e.response?.data?.detail || e.message || 'Unknown error';
            Alert.alert('Piano Playback Error', `Failed to play on the Disklavier piano: ${msg}. Playing backing audio locally.`);
          }
        }
      };

      if (globalOffset >= 0) {
        // Play local backing audio immediately
        await soundRef.current.playAsync();
        
        if (globalOffset > 0) {
          playbackTimerRef.current = setTimeout(async () => {
            await playPianoMidi();
          }, globalOffset);
        } else {
          await playPianoMidi();
        }
      } else {
        // Play disklavier MIDI immediately
        await playPianoMidi();
        
        // Delay backing audio
        playbackTimerRef.current = setTimeout(async () => {
          if (soundRef.current) {
            await soundRef.current.playAsync();
          }
        }, Math.abs(globalOffset));
      }
    } catch (e: any) {
      console.error(e);
      setIsPlaying(false);
      setSystemBusy(false);
      const msg = e.response?.data?.detail || e.message || 'Unknown error';
      Alert.alert('Playback Error', `Failed to start synchronized playback: ${msg}`);
    }
  };

  const pausePlayback = async () => {
    if (playbackTimerRef.current) {
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    if (soundRef.current) {
      await soundRef.current.pauseAsync();
    }
    await pianoApi.stop();
    setIsPlaying(false);
    setSystemBusy(false);
  };

  const stopPlayback = async () => {
    if (playbackTimerRef.current) {
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
      } catch (e) {}
    }
    await pianoApi.stop();
    setIsPlaying(false);
    setSystemBusy(false);
    setPlaybackPos(0);
    scrollRef.current?.scrollTo({ x: 0, animated: true });
  };

  // Format Duration helper
  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const secs = s % 60;
    return `${m}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Color picker for tracks/visualizer
  const getTrackColor = (trackIndex: number, isPiano: boolean, isSpeaker: boolean) => {
    if (isPiano) return themeColors.accent; // Vibrant Blue/Cyan
    if (isSpeaker) return '#a29bfe'; // Light purple for strings/speakers
    return themeColors.textMuted;
  };

  // visualizer math functions
  const getLanesData = useMemo(() => {
    if (!currentJob || !notes) return [];
    
    // Build lanes only for tracks containing notes
    return currentJob.tracks.filter((t: any) => {
      const trackNotes = notes[String(t.index)] || [];
      return trackNotes.length > 0;
    }).map((track: any) => {
      const trackNotes = notes[String(track.index)] || [];
      const pitches = trackNotes.map(n => n.pitch);
      const minPitch = pitches.length > 0 ? Math.min(...pitches) : 40;
      const maxPitch = pitches.length > 0 ? Math.max(...pitches) : 80;
      const pitchRange = Math.max(12, maxPitch - minPitch); // avoid division by zero, min 1 octave height scale
      
      return {
        ...track,
        notes: trackNotes,
        minPitch,
        maxPitch,
        pitchRange
      };
    });
  }, [currentJob, notes]);

  // Timeline render item notes
  const renderVisualizerTimeline = () => {
    const durationSec = playbackDuration / 1000 || currentJob?.tracks[0]?.duration || 180;
    const timelineWidth = durationSec * PIXELS_PER_SECOND;
    const totalHeight = getLanesData.length * LANE_HEIGHT;

    return (
      <ScrollView 
        style={[styles.verticalLanesScrollView, { backgroundColor: themeColors.background }]}
        contentContainerStyle={{ flexGrow: 1 }}
        removeClippedSubviews={true}
      >
        <View style={styles.visualizerContainer}>
          {/* Left Track Names Sidebar */}
          <View style={[styles.sidebar, { borderRightColor: themeColors.border, backgroundColor: themeColors.surface, height: totalHeight }]}>
          {getLanesData.map((lane: any) => {
            const isPiano = pianoTracks.has(lane.index);
            const isSpeaker = speakerTracks.has(lane.index);
            const isMuted = !isPiano && !isSpeaker;
            
            return (
              <View key={lane.index} style={[styles.sidebarLane, { height: LANE_HEIGHT, borderBottomColor: themeColors.border }]}>
                <Text style={[styles.sidebarLaneTitle, { color: themeColors.text }]} numberOfLines={1}>
                  {lane.name}
                </Text>
                
                {/* 3-Way Live Toggle Row */}
                <View style={styles.allocationRow}>
                  <TouchableOpacity 
                    style={[
                      styles.allocToggleBtn, 
                      isPiano && { backgroundColor: themeColors.accent }
                    ]}
                    onPress={() => handleToggleTrackRole(lane.index, 'piano')}
                  >
                    <Ionicons name="musical-notes" size={12} color={isPiano ? "#fff" : themeColors.textMuted} />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[
                      styles.allocToggleBtn, 
                      isSpeaker && { backgroundColor: '#a29bfe' }
                    ]}
                    onPress={() => handleToggleTrackRole(lane.index, 'speakers')}
                  >
                    <Ionicons name="volume-high" size={12} color={isSpeaker ? "#fff" : themeColors.textMuted} />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[
                      styles.allocToggleBtn, 
                      isMuted && { backgroundColor: themeColors.border }
                    ]}
                    onPress={() => handleToggleTrackRole(lane.index, 'mute')}
                  >
                    <Ionicons name="volume-mute" size={12} color={isMuted ? themeColors.text : themeColors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
          </View>

          {/* Scrollable Lanes Grid */}
          <ScrollView 
            horizontal 
            ref={scrollRef}
            showsHorizontalScrollIndicator={true}
            style={[styles.lanesScrollView, { backgroundColor: themeColors.background, height: totalHeight }]}
            removeClippedSubviews={true}
          >
            <View style={{ width: timelineWidth, height: totalHeight }}>
            <NoteGrid
              lanesData={getLanesData}
              pianoTracks={pianoTracks}
              speakerTracks={speakerTracks}
              themeColors={themeColors}
              durationSec={durationSec}
              timelineWidth={timelineWidth}
              totalHeight={totalHeight}
            />

            {/* Glowing Vertical Playhead */}
            <View 
              style={[
                styles.playheadLine, 
                { 
                  left: (playbackPos / 1000) * PIXELS_PER_SECOND, 
                  height: totalHeight,
                  backgroundColor: themeColors.accent
                }
              ]} 
            />
          </View>
        </ScrollView>
      </View>
      </ScrollView>
    );
  };

  const handleExitWorkspace = () => {
    stopPlayback();
    stopPreview();
    setStage('list');
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      
      {/* 1. LIST STAGE */}
      {stage === 'list' && (
        <View style={styles.listContainer}>
          {/* Action Bar for multi-select */}
          {selectedJobs.size > 0 && (
            <View style={[styles.actionBar, { backgroundColor: themeColors.accent }]}>
              <TouchableOpacity style={styles.actionCount} onPress={clearSelection}>
                <Ionicons name="close-circle" size={24} color="#fff" />
                <Text style={styles.actionCountText}>{selectedJobs.size}</Text>
              </TouchableOpacity>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionButtons}>
                {selectedJobs.size === 1 && (
                  <>
                    <TouchableOpacity style={styles.barBtn} onPress={() => {
                      const jobId = Array.from(selectedJobs)[0];
                      const job = jobs.find(j => j.job_id === jobId);
                      if (job) {
                        clearSelection();
                        handleJobSelect(job);
                      }
                    }}>
                      <Ionicons name="create-outline" size={20} color="#fff" />
                      <Text style={styles.barBtnText}>Workspace</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.barBtn} onPress={() => {
                      const jobId = Array.from(selectedJobs)[0];
                      const job = jobs.find(j => j.job_id === jobId);
                      if (job) {
                        clearSelection();
                        handleOpenReclean(job);
                      }
                    }}>
                      <Ionicons name="sparkles-outline" size={20} color="#fff" />
                      <Text style={styles.barBtnText}>Re-clean</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.barBtn} onPress={() => {
                      const jobId = Array.from(selectedJobs)[0];
                      const job = jobs.find(j => j.job_id === jobId);
                      if (job) {
                        clearSelection();
                        handleOpenDetails(job);
                      }
                    }}>
                      <Ionicons name="information-circle-outline" size={20} color="#fff" />
                      <Text style={styles.barBtnText}>Details</Text>
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity style={styles.barBtn} onPress={handleBulkDelete}>
                  <Ionicons name="trash-outline" size={20} color="#fff" />
                  <Text style={[styles.barBtnText, { color: '#fff' }]}>Delete</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}

          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: themeColors.text }]}>MIDI Orchestrator</Text>
            <TouchableOpacity 
              style={[styles.uploadBtn, { backgroundColor: themeColors.accent }]} 
              onPress={handleUpload}
              disabled={loading}
            >
              <Ionicons name="cloud-upload" size={16} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.uploadBtnText}>Upload MIDI</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={themeColors.accent} style={{ marginTop: 50 }} />
          ) : (
            <FlatList
              data={jobs}
              keyExtractor={item => item.job_id}
              contentContainerStyle={{ padding: 15 }}
              extraData={selectedJobs}
              renderItem={({ item }) => {
                const isSelected = selectedJobs.has(item.job_id);
                return (
                  <TouchableOpacity 
                    style={[
                      styles.jobCard, 
                      isSelected && { backgroundColor: themeColors.accentLight }, 
                      { backgroundColor: themeColors.surface, borderColor: themeColors.border }
                    ]}
                    onPress={() => {
                      if (selectedJobs.size > 0) {
                        toggleSelect(item.job_id);
                      } else {
                        handleJobSelect(item);
                      }
                    }}
                    onLongPress={() => toggleSelect(item.job_id)}
                  >
                    <View style={styles.selectionIndicator}>
                      <Ionicons 
                        name={isSelected ? "checkmark-circle" : "ellipse-outline"} 
                        size={22} 
                        color={isSelected ? themeColors.accent : themeColors.textMuted} 
                      />
                    </View>

                    <View style={styles.jobInfo}>
                      {/* Row 1: Title & Playlist tags */}
                      <View style={styles.titleRow}>
                        <Text style={[styles.jobFilename, { color: themeColors.text }]} numberOfLines={1}>
                          {getCleanTitle(item.filename)}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                          {item.playlists?.map((pl: string) => (
                            <View key={pl} style={[styles.cleanBadge, { backgroundColor: 'rgba(76, 175, 80, 0.1)' }]}>
                              <Text style={[styles.cleanBadgeText, { color: '#4CAF50' }]}>{pl.toUpperCase()}</Text>
                            </View>
                          ))}
                        </View>
                      </View>

                      {/* Row 2: Artist */}
                      <Text style={{ fontSize: 12, color: item.artist ? themeColors.accent : themeColors.textMuted, fontWeight: '600', marginTop: 1, marginBottom: 4 }} numberOfLines={1}>
                        {item.artist || 'Unknown Artist'}
                      </Text>

                      {/* Row 3: Length, Date, dynamic velocity/pedal settings, and rating stars */}
                      <View style={styles.metaRow}>
                        <Text style={[styles.jobMeta, { color: themeColors.textMuted }]}>
                          {getSongLength(item) ? `${getSongLength(item)} • ` : ''}
                          {new Date(item.timestamp * 1000).toLocaleDateString()}
                        </Text>

                        {item.status === 'completed' && (
                          <>
                            {item.melody_factor !== undefined && (
                              <View style={[styles.statBadge, { backgroundColor: themeColors.surfaceSecondary }]}>
                                <Text style={[styles.statBadgeText, { color: themeColors.textMuted }]}>M:{Math.round(item.melody_factor * 100)}%</Text>
                              </View>
                            )}
                            {item.rhythm_factor !== undefined && (
                              <View style={[styles.statBadge, { backgroundColor: themeColors.surfaceSecondary }]}>
                                <Text style={[styles.statBadgeText, { color: themeColors.textMuted }]}>R:{Math.round(item.rhythm_factor * 100)}%</Text>
                              </View>
                            )}
                            {item.pedal_preset && (
                              <View style={[styles.statBadge, { backgroundColor: themeColors.surfaceSecondary }]}>
                                <Text style={[styles.statBadgeText, { color: themeColors.textMuted }]}>P:{item.pedal_preset.charAt(0).toUpperCase()}</Text>
                              </View>
                            )}
                          </>
                        )}

                        {/* Stars */}
                        {renderStars(item.rating)}

                        {/* DNU Badge */}
                        {item.dnu && (
                          <View style={[styles.statBadge, { backgroundColor: 'rgba(231, 76, 60, 0.15)' }]}>
                            <Text style={[styles.statBadgeText, { color: '#e74c3c' }]}>DNU</Text>
                          </View>
                        )}
                      </View>

                      {/* Progress details */}
                      {(item.status === 'processing' || item.status === 'synthesizing') && (
                        <View style={styles.progressContainer}>
                          <View style={[styles.progressBarBg, { backgroundColor: themeColors.surfaceSecondary }]}>
                            <View style={[styles.progressBarFill, { width: `${item.progress}%`, backgroundColor: themeColors.accent }]} />
                          </View>
                          <Text style={[styles.progressText, { color: themeColors.textMuted }]}>
                            {item.status === 'synthesizing' ? 'Rendering Strings...' : `Processing ${item.progress}%`}
                          </Text>
                        </View>
                      )}

                      {/* Failed Badge */}
                      {item.status === 'failed' && (
                        <View style={[styles.statusBadge, { backgroundColor: 'rgba(231, 76, 60, 0.15)', marginTop: 5 }]}>
                          <Ionicons name="alert-circle" size={12} color="#e74c3c" />
                          <Text style={[styles.statusText, { color: '#e74c3c' }]}>Failed: {item.error}</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.cardActions}>
                      <Ionicons name="chevron-forward" size={20} color={themeColors.accent} />
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', marginTop: 80 }}>
                  <Ionicons name="musical-notes-outline" size={60} color={themeColors.textMuted} style={{ marginBottom: 15 }} />
                  <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>No MIDI Orchestrator jobs found.</Text>
                  <Text style={[styles.emptySubtext, { color: themeColors.textMuted }]}>Upload a multitrack MIDI file to get started.</Text>
                </View>
              }
            />
          )}

          {/* Context Actions Bottom Sheet */}
          <Modal
            visible={contextJob !== null && !recleanVisible && !detailsVisible}
            transparent
            animationType="slide"
            onRequestClose={handleCloseContextActions}
          >
            <TouchableOpacity 
              style={styles.modalOverlay} 
              activeOpacity={1} 
              onPress={handleCloseContextActions}
            >
              <View style={[styles.bottomSheetContent, { backgroundColor: themeColors.surface }]}>
                <View style={[styles.bottomSheetHeader, { borderBottomColor: themeColors.border }]}>
                  <Text style={[styles.bottomSheetTitle, { color: themeColors.text }]} numberOfLines={1}>
                    {getCleanTitle(contextJob?.filename)}
                  </Text>
                  <Text style={[styles.bottomSheetSub, { color: themeColors.textMuted }]}>
                    Select an action
                  </Text>
                </View>

                <TouchableOpacity 
                  style={[styles.bottomSheetItem, { borderBottomColor: themeColors.border }]} 
                  onPress={() => {
                    const job = contextJob;
                    handleCloseContextActions();
                    handleJobSelect(job);
                  }}
                >
                  <Ionicons name="create-outline" size={22} color={themeColors.accent} />
                  <Text style={[styles.bottomSheetItemText, { color: themeColors.text }]}>Edit Allocations (Workspace)</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.bottomSheetItem, { borderBottomColor: themeColors.border }]} 
                  onPress={() => {
                    const job = contextJob;
                    handleCloseContextActions();
                    handleOpenReclean(job);
                  }}
                >
                  <Ionicons name="sparkles-outline" size={22} color={themeColors.accent} />
                  <Text style={[styles.bottomSheetItemText, { color: themeColors.text }]}>Quick Re-clean Settings</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.bottomSheetItem, { borderBottomColor: themeColors.border }]} 
                  onPress={() => {
                    const job = contextJob;
                    handleCloseContextActions();
                    handleOpenDetails(job);
                  }}
                >
                  <Ionicons name="information-circle-outline" size={22} color={themeColors.accent} />
                  <Text style={[styles.bottomSheetItemText, { color: themeColors.text }]}>Edit Details & Rename</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.bottomSheetItem, { borderBottomColor: themeColors.border }]} 
                  onPress={() => {
                    const job = contextJob;
                    handleCloseContextActions();
                    handleDeleteJob(job.job_id);
                  }}
                >
                  <Ionicons name="trash-outline" size={22} color="#ff4d4d" />
                  <Text style={[styles.bottomSheetItemText, { color: '#ff4d4d' }]}>Delete Job</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.bottomSheetCancel, { backgroundColor: themeColors.surfaceSecondary }]} 
                  onPress={handleCloseContextActions}
                >
                  <Text style={[styles.bottomSheetCancelText, { color: themeColors.text }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>

          {/* Quick Re-clean Modal */}
          <Modal
            visible={recleanVisible}
            transparent
            animationType="fade"
            onRequestClose={() => { setRecleanVisible(false); setContextJob(null); }}
          >
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { backgroundColor: themeColors.surface }]}>
                <Text style={[styles.modalTitle, { color: themeColors.text }]}>Quick Re-clean</Text>
                <Text style={[styles.modalSubtitle, { color: themeColors.textMuted }]}>
                  Adjust velocity dynamics & pedals for {getCleanTitle(contextJob?.filename)}
                </Text>

                {/* Pedal Preset badge */}
                <View style={{ marginBottom: 20, width: '100%' }}>
                  <Text style={[styles.label, { color: themeColors.text, marginBottom: 10 }]}>Pedal Intensity</Text>
                  <View style={styles.presetBadgesRow}>
                    {['light', 'medium', 'full'].map((preset) => (
                      <TouchableOpacity
                        key={preset}
                        style={[
                          styles.presetBadge,
                          recleanPedal === preset ? { backgroundColor: themeColors.accent, borderColor: themeColors.accent } : { backgroundColor: themeColors.surface }
                        ]}
                        onPress={() => setRecleanPedal(preset as any)}
                      >
                        <Text style={[styles.presetBadgeText, { color: recleanPedal === preset ? '#fff' : themeColors.text }]}>
                          {preset.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Rhythm factor steppers */}
                <View style={styles.sliderContainer}>
                  <Text style={[styles.label, { color: themeColors.text, marginBottom: 10 }]}>Rhythm Velocity</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: themeColors.surfaceSecondary, borderRadius: 8, padding: 5 }}>
                    <TouchableOpacity 
                      onPress={() => setRecleanRhythm(prev => Math.max(0.2, Number((prev - 0.05).toFixed(2))))}
                      style={{ padding: 10 }}
                    >
                      <Ionicons name="remove-circle-outline" size={32} color={themeColors.accent} />
                    </TouchableOpacity>
                    <Text style={{ color: themeColors.accent, fontWeight: '700', fontSize: 18, minWidth: 60, textAlign: 'center' }}>
                      {Math.round(recleanRhythm * 100)}%
                    </Text>
                    <TouchableOpacity 
                      onPress={() => setRecleanRhythm(prev => Math.min(2.0, Number((prev + 0.05).toFixed(2))))}
                      style={{ padding: 10 }}
                    >
                      <Ionicons name="add-circle-outline" size={32} color={themeColors.accent} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Melody factor steppers */}
                <View style={styles.sliderContainer}>
                  <Text style={[styles.label, { color: themeColors.text, marginBottom: 10 }]}>Melody Velocity</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: themeColors.surfaceSecondary, borderRadius: 8, padding: 5 }}>
                    <TouchableOpacity 
                      onPress={() => setRecleanMelody(prev => Math.max(0.2, Number((prev - 0.05).toFixed(2))))}
                      style={{ padding: 10 }}
                    >
                      <Ionicons name="remove-circle-outline" size={32} color={themeColors.accent} />
                    </TouchableOpacity>
                    <Text style={{ color: themeColors.accent, fontWeight: '700', fontSize: 18, minWidth: 60, textAlign: 'center' }}>
                      {Math.round(recleanMelody * 100)}%
                    </Text>
                    <TouchableOpacity 
                      onPress={() => setRecleanMelody(prev => Math.min(2.0, Number((prev + 0.05).toFixed(2))))}
                      style={{ padding: 10 }}
                    >
                      <Ionicons name="add-circle-outline" size={32} color={themeColors.accent} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity 
                    style={[styles.modalBtn, { borderColor: themeColors.border, borderWidth: 1 }]}
                    onPress={() => { setRecleanVisible(false); setContextJob(null); }}
                  >
                    <Text style={{ color: themeColors.text }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.modalBtn, { backgroundColor: themeColors.accent }]}
                    onPress={handleRunQuickReclean}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Save & Synthesize</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Edit Details & Rename Modal */}
          <Modal
            visible={detailsVisible}
            transparent
            animationType="slide"
            onRequestClose={() => { setDetailsVisible(false); setContextJob(null); }}
          >
            <View style={[styles.modalOverlay, { justifyContent: 'flex-end' }]}>
              <KeyboardAvoidingView 
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 60}
                style={{ width: '100%' }}
              >
                <View style={[styles.modalContent, { 
                  backgroundColor: themeColors.surface, 
                  borderBottomLeftRadius: 0, 
                  borderBottomRightRadius: 0,
                  maxHeight: '90%',
                  width: '100%',
                  paddingBottom: 30
                }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <Text style={[styles.modalTitle, { color: themeColors.text }]}>Song Details</Text>
                    <TouchableOpacity onPress={() => { setDetailsVisible(false); setContextJob(null); }}>
                      <Ionicons name="close" size={24} color={themeColors.text} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView 
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 40 }}
                  >
                    {/* Star Rating Section */}
                    <View style={[styles.detailRow, { marginBottom: 20 }]}>
                      <View>
                        <Text style={{ color: themeColors.text, fontWeight: '600' }}>Rating</Text>
                        <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Rate this performance</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 5 }}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <TouchableOpacity key={star} onPress={() => setDetailsRating(detailsRating === star ? 0 : star)}>
                            <Ionicons 
                              name={star <= detailsRating ? "star" : "star-outline"} 
                              size={24} 
                              color={star <= detailsRating ? '#FFD700' : themeColors.textMuted} 
                            />
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    {/* Do Not Use Switch */}
                    <View style={[styles.detailRow, { marginBottom: 20 }]}>
                      <View>
                        <Text style={{ color: themeColors.text, fontWeight: '600' }}>Do Not Use (DNU)</Text>
                        <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Mark as unsafe or poor quality</Text>
                      </View>
                      <Switch 
                        value={detailsDnu} 
                        onValueChange={setDetailsDnu} 
                        trackColor={{ false: themeColors.border, true: '#ff5252' }} 
                      />
                    </View>

                    {/* Title / Filename Field */}
                    <View style={styles.metaField}>
                      <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Title / Filename</Text>
                      <TextInput
                        style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]}
                        value={detailsTitle}
                        onChangeText={setDetailsTitle}
                        placeholder="Song title"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>

                    {/* Artist Field */}
                    <View style={styles.metaField}>
                      <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Artist</Text>
                      <TextInput
                        style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]}
                        value={detailsArtist}
                        onChangeText={setDetailsArtist}
                        placeholder="Unknown Artist"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>

                    {/* Genre and Mood Row */}
                    <View style={{ flexDirection: 'row', gap: 15, marginBottom: 15 }}>
                      <View style={[styles.metaField, { flex: 1 }]}>
                        <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Genre</Text>
                        <TextInput 
                          style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]} 
                          value={detailsGenre} 
                          onChangeText={setDetailsGenre}
                          placeholder="None"
                          placeholderTextColor={themeColors.textMuted}
                        />
                      </View>
                      <View style={[styles.metaField, { flex: 1 }]}>
                        <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Mood</Text>
                        <TextInput 
                          style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]} 
                          value={detailsMood} 
                          onChangeText={setDetailsMood}
                          placeholder="None"
                          placeholderTextColor={themeColors.textMuted}
                        />
                      </View>
                    </View>

                    {/* Source Field */}
                    <View style={styles.metaField}>
                      <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Source (Game/Movie)</Text>
                      <TextInput 
                        style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]} 
                        value={detailsSource} 
                        onChangeText={setDetailsSource}
                        placeholder="None"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>

                    {/* Comments Field */}
                    <View style={[styles.metaField, { marginTop: 10 }]}>
                      <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Comments / Notes</Text>
                      <TextInput
                        style={[styles.textArea, { borderColor: themeColors.border, backgroundColor: themeColors.background, color: themeColors.text, textAlignVertical: 'top', marginTop: 5 }]}
                        value={detailsComments}
                        onChangeText={setDetailsComments}
                        placeholder="Add notes..."
                        placeholderTextColor={themeColors.textMuted}
                        multiline
                        numberOfLines={3}
                      />
                    </View>
                  </ScrollView>

                  <View style={styles.modalButtons}>
                    <TouchableOpacity 
                      style={[styles.modalBtn, styles.modalBtnFlex, { backgroundColor: themeColors.surfaceSecondary }]} 
                      onPress={() => { setDetailsVisible(false); setContextJob(null); }}
                    >
                      <Text style={{ color: themeColors.text }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.modalBtn, styles.modalBtnFlex, { backgroundColor: themeColors.accent }]} 
                      onPress={handleSaveDetails}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </View>
          </Modal>
        </View>
      )}

      {/* 2. VISUALIZER & PLAYBACK STAGE */}
      {stage === 'visualizer' && currentJob && (
        <View style={styles.visualizerStage}>
          {/* Header */}
          <View style={[styles.visualizerHeader, { borderBottomColor: themeColors.border, backgroundColor: themeColors.surface }]}>
            <TouchableOpacity onPress={handleExitWorkspace}>
              <Ionicons name="arrow-back" size={24} color={themeColors.text} />
            </TouchableOpacity>
            
            <View style={{ flex: 1, marginLeft: 15 }}>
              <Text style={[styles.visualizerFilename, { color: themeColors.text }]} numberOfLines={1}>
                {currentJob.filename}
              </Text>
              <Text style={[styles.visualizerStateSub, { color: themeColors.textMuted }]}>
                {isPlaying ? 'Playing synced playback' : isPreviewPlaying ? 'Playing preview' : 'Playback stopped'}
              </Text>
            </View>

            {/* Settings Toggle Button */}
            <TouchableOpacity onPress={() => setShowSettings(!showSettings)} style={{ marginRight: 15 }}>
              <Ionicons 
                name={showSettings ? "options" : "options-outline"} 
                size={24} 
                color={showSettings ? themeColors.accent : themeColors.text} 
              />
            </TouchableOpacity>
            
            {/* Sync Delay Controls */}
            <View style={styles.delayControls}>
              <Text style={[styles.delayLabel, { color: themeColors.textMuted }]}>Speaker Sync</Text>
              <View style={styles.delayButtonsRow}>
                <TouchableOpacity 
                  style={[styles.offsetBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                  onPress={() => setGlobalOffset(globalOffset - 10)}
                >
                  <Text style={[styles.offsetBtnText, { color: themeColors.text }]}>-10ms</Text>
                </TouchableOpacity>
                <Text style={[styles.offsetValue, { color: themeColors.text, fontWeight: '700' }]}>
                  {globalOffset >= 0 ? `+${globalOffset}` : globalOffset}ms
                </Text>
                <TouchableOpacity 
                  style={[styles.offsetBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                  onPress={() => setGlobalOffset(globalOffset + 10)}
                >
                  <Text style={[styles.offsetBtnText, { color: themeColors.text }]}>+10ms</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Collapsible Settings Panel */}
          {showSettings && (
            <View style={[styles.settingsPanel, { backgroundColor: themeColors.surfaceSecondary, borderBottomColor: themeColors.border }]}>
              {/* Pedal presets */}
              <View style={styles.settingItemRow}>
                <Text style={[styles.settingItemLabel, { color: themeColors.text }]}>Pedal Preset</Text>
                <View style={styles.presetsGroup}>
                  {['light', 'medium', 'full'].map(preset => (
                    <TouchableOpacity
                      key={preset}
                      style={[
                        styles.presetBadge,
                        pedalPreset === preset ? { backgroundColor: themeColors.accent, borderColor: themeColors.accent } : { backgroundColor: themeColors.surface }
                      ]}
                      onPress={() => setPedalPreset(preset as any)}
                    >
                      <Text style={[styles.presetBadgeText, { color: pedalPreset === preset ? '#fff' : themeColors.text }]}>
                        {preset.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Rhythm Factor */}
              <View style={styles.settingItemRow}>
                <Text style={[styles.settingItemLabel, { color: themeColors.text }]}>
                  Rhythm Velocity ({rhythmFactor.toFixed(2)}x)
                </Text>
                <View style={styles.stepButtonsContainer}>
                  <TouchableOpacity 
                    style={[styles.stepBtn, { backgroundColor: themeColors.surface }]}
                    onPress={() => setRhythmFactor(prev => Math.max(0.2, Number((prev - 0.05).toFixed(2))))}
                  >
                    <Ionicons name="remove" size={16} color={themeColors.text} />
                  </TouchableOpacity>
                  
                  <Text style={[styles.stepValueText, { color: themeColors.text }]}>
                    {rhythmFactor.toFixed(2)}x
                  </Text>
                  
                  <TouchableOpacity 
                    style={[styles.stepBtn, { backgroundColor: themeColors.surface }]}
                    onPress={() => setRhythmFactor(prev => Math.min(2.0, Number((prev + 0.05).toFixed(2))))}
                  >
                    <Ionicons name="add" size={16} color={themeColors.text} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Melody Factor */}
              <View style={styles.settingItemRow}>
                <Text style={[styles.settingItemLabel, { color: themeColors.text }]}>
                  Melody Velocity ({melodyFactor.toFixed(2)}x)
                </Text>
                <View style={styles.stepButtonsContainer}>
                  <TouchableOpacity 
                    style={[styles.stepBtn, { backgroundColor: themeColors.surface }]}
                    onPress={() => setMelodyFactor(prev => Math.max(0.2, Number((prev - 0.05).toFixed(2))))}
                  >
                    <Ionicons name="remove" size={16} color={themeColors.text} />
                  </TouchableOpacity>
                  
                  <Text style={[styles.stepValueText, { color: themeColors.text }]}>
                    {melodyFactor.toFixed(2)}x
                  </Text>
                  
                  <TouchableOpacity 
                    style={[styles.stepBtn, { backgroundColor: themeColors.surface }]}
                    onPress={() => setMelodyFactor(prev => Math.min(2.0, Number((prev + 0.05).toFixed(2))))}
                  >
                    <Ionicons name="add" size={16} color={themeColors.text} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* Timeline Visualizer lanes rendering */}
          {renderVisualizerTimeline()}

          {/* Synced Playback Controls Bar */}
          <View style={[styles.controlsBar, { backgroundColor: themeColors.surface, borderTopColor: themeColors.border }]}>
            {/* Time progress */}
            <View style={styles.timeRow}>
              <Text style={{ color: themeColors.text, fontSize: 12 }}>{formatTime(playbackPos)}</Text>
              <Text style={[styles.modeIndicatorText, { color: (currentJob.status !== 'completed' || hasChanges) ? '#a29bfe' : themeColors.accent }]}>
                {(currentJob.status !== 'completed' || hasChanges) ? 'Preview Mode' : 'Performance Mode'}
              </Text>
              <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>{formatTime(playbackDuration)}</Text>
            </View>

            {/* Main Buttons */}
            <View style={styles.buttonsRow}>
              {(currentJob.status !== 'completed' || hasChanges) ? (
                // PREVIEW PLAY BUTTON
                <>
                  <TouchableOpacity 
                    style={[styles.playbackStopBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                    onPress={stopPreview}
                  >
                    <Ionicons name="square" size={24} color={themeColors.text} />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.playbackPlayBtn, { backgroundColor: '#a29bfe' }]}
                    onPress={handleTogglePreview}
                    disabled={isPreviewLoading}
                  >
                    {isPreviewLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Ionicons name={isPreviewPlaying ? "pause" : "play"} size={36} color="#fff" />
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.miniProcessBtn, { backgroundColor: themeColors.accent }]}
                    onPress={handleProcess}
                    disabled={loading || isPreviewPlaying}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="color-wand" size={16} color="#fff" style={{ marginRight: 6 }} />
                        <Text style={styles.miniProcessBtnText}>Synthesize</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                // PERFORMANCE PLAY BUTTON
                <>
                  <TouchableOpacity 
                    style={[styles.playbackStopBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                    onPress={stopPlayback}
                  >
                    <Ionicons name="square" size={24} color={themeColors.text} />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.playbackPlayBtn, { backgroundColor: themeColors.accent }]}
                    onPress={isPlaying ? pausePlayback : startPlayback}
                  >
                    <Ionicons name={isPlaying ? "pause" : "play"} size={36} color="#fff" />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>

        </View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  uploadBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  jobCard: {
    flexDirection: 'row',
    padding: 8,
    paddingHorizontal: 15,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    alignItems: 'center',
  },
  jobInfo: {
    flex: 1,
  },
  jobFilename: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  jobMeta: {
    fontSize: 11,
  },
  progressContainer: {
    marginTop: 5,
  },
  progressBarBg: {
    height: 4,
    width: '100%',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
  },
  progressText: {
    fontSize: 11,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignSelf: 'flex-start',
    gap: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  deleteCardBtn: {
    padding: 5,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptySubtext: {
    fontSize: 12,
  },

  // CONFIGURATION STAGE STYLES REMOVED (CONSOLIDATED INTO WORKSPACE)

  // VISUALIZER STAGE
  visualizerStage: {
    flex: 1,
  },
  visualizerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
  },
  visualizerFilename: {
    fontSize: 16,
    fontWeight: '700',
  },
  visualizerStateSub: {
    fontSize: 11,
    marginTop: 2,
  },
  delayControls: {
    alignItems: 'flex-end',
  },
  delayLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  delayButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  offsetBtn: {
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  offsetBtnText: {
    fontSize: 10,
    fontWeight: '700',
  },
  offsetValue: {
    fontSize: 11,
    minWidth: 40,
    textAlign: 'center',
  },

  // Timeline UI Layout
  visualizerContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 110,
    borderRightWidth: 1,
    zIndex: 10,
  },
  sidebarLane: {
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  sidebarLaneTitle: {
    fontSize: 11,
    fontWeight: '700',
  },
  sidebarBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 3,
    gap: 2,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '700',
  },
  verticalLanesScrollView: {
    flex: 1,
  },
  lanesScrollView: {
    flex: 1,
  },
  settingsPanel: {
    padding: 15,
    borderBottomWidth: 1,
  },
  settingItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  settingItemLabel: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  presetsGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  presetBadge: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  presetBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  allocationRow: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 6,
  },
  allocToggleBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  miniProcessBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginLeft: 15,
  },
  miniProcessBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  modeIndicatorText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  laneTimeline: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderBottomWidth: 1,
  },
  gridLine: {
    position: 'absolute',
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.15,
  },
  note: {
    position: 'absolute',
    borderRadius: 1.5,
  },
  playheadLine: {
    position: 'absolute',
    width: 1.5,
    top: 0,
    bottom: 0,
    zIndex: 5,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
  },

  // Playback Control Bar
  controlsBar: {
    padding: 15,
    paddingBottom: 25,
    borderTopWidth: 1,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 30,
  },
  playbackPlayBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  playbackStopBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  stepValueText: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 45,
    textAlign: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 6,
  },
  statBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  settingsBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  cleanBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cleanBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  bottomSheetContent: {
    width: '100%',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    position: 'absolute',
    bottom: 0,
    elevation: 20,
  },
  bottomSheetHeader: {
    paddingBottom: 12,
    borderBottomWidth: 1,
    marginBottom: 12,
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  bottomSheetSub: {
    fontSize: 12,
    marginTop: 2,
  },
  bottomSheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  bottomSheetItemText: {
    fontSize: 15,
    fontWeight: '600',
  },
  bottomSheetCancel: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 15,
  },
  bottomSheetCancelText: {
    fontWeight: '600',
    fontSize: 15,
  },
  inputContainer: {
    marginBottom: 12,
    width: '100%',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  aiInfoBlock: {
    padding: 10,
    borderRadius: 8,
    marginVertical: 8,
    width: '100%',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    width: '100%',
  },
  modalBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  presetBadgesRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  sliderContainer: {
    width: '100%',
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  metaField: {
    marginBottom: 12,
    width: '100%',
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  metaInput: {
    fontSize: 15,
    borderBottomWidth: 1,
    paddingVertical: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 20,
  },
  modalBtnFlex: {
    flex: 1,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
  },
  actionBar: { 
    flexDirection: 'row', 
    padding: 10, 
    alignItems: 'center', 
    position: 'absolute', 
    top: 0, 
    left: 0, 
    right: 0, 
    zIndex: 100, 
    elevation: 10, 
    height: 75, 
    paddingTop: Platform.OS === 'ios' ? 30 : 10 
  },
  actionCount: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 15, 
    borderRightWidth: 1, 
    borderRightColor: 'rgba(255,255,255,0.2)' 
  },
  actionCountText: { 
    color: '#fff', 
    fontWeight: '700', 
    marginLeft: 5 
  },
  actionButtons: { 
    paddingHorizontal: 10, 
    gap: 20, 
    alignItems: 'center',
    flexDirection: 'row'
  },
  barBtn: { 
    alignItems: 'center', 
    minWidth: 50 
  },
  barBtnText: { 
    fontSize: 10, 
    color: '#fff', 
    fontWeight: '600', 
    marginTop: 2 
  },
  selectionIndicator: { 
    marginRight: 12 
  }
});
