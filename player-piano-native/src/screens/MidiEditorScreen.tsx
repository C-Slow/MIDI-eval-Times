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
  InteractionManager
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
  const previewSoundRef = useRef<Audio.Sound | null>(null);

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
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={[styles.jobCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}
                  onPress={() => handleJobSelect(item)}
                >
                  <View style={styles.jobInfo}>
                    <Text style={[styles.jobFilename, { color: themeColors.text }]} numberOfLines={1}>
                      {item.filename}
                    </Text>
                    
                    <Text style={[styles.jobMeta, { color: themeColors.textMuted }]}>
                      {new Date(item.timestamp * 1000).toLocaleDateString()} • {item.tracks?.length || 0} tracks
                    </Text>

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

                    {/* Status Badges */}
                    {item.status === 'completed' && (
                      <View style={[styles.statusBadge, { backgroundColor: 'rgba(46, 204, 113, 0.15)' }]}>
                        <Ionicons name="checkmark-circle" size={12} color="#2ecc71" />
                        <Text style={[styles.statusText, { color: '#2ecc71' }]}>Ready Playback</Text>
                      </View>
                    )}
                    {item.status === 'failed' && (
                      <View style={[styles.statusBadge, { backgroundColor: 'rgba(231, 76, 60, 0.15)' }]}>
                        <Ionicons name="alert-circle" size={12} color="#e74c3c" />
                        <Text style={[styles.statusText, { color: '#e74c3c' }]}>Failed: {item.error}</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.cardActions}>
                    <TouchableOpacity 
                      style={styles.deleteCardBtn}
                      onPress={() => handleDeleteJob(item.job_id)}
                    >
                      <Ionicons name="trash-outline" size={20} color={themeColors.textMuted} />
                    </TouchableOpacity>
                    <Ionicons name="chevron-forward" size={20} color={themeColors.accent} />
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', marginTop: 80 }}>
                  <Ionicons name="musical-notes-outline" size={60} color={themeColors.textMuted} style={{ marginBottom: 15 }} />
                  <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>No MIDI Orchestrator jobs found.</Text>
                  <Text style={[styles.emptySubtext, { color: themeColors.textMuted }]}>Upload a multitrack MIDI file to get started.</Text>
                </View>
              }
            />
          )}
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
                <Text style={[styles.settingItemLabel, { color: themeColors.text, marginRight: 10 }]}>
                  Rhythm Velocity ({rhythmFactor.toFixed(2)}x)
                </Text>
                <Slider
                  style={{ flex: 1, height: 40 }}
                  minimumValue={0.2}
                  maximumValue={2.0}
                  value={rhythmFactor}
                  onValueChange={setRhythmFactor}
                  minimumTrackTintColor={themeColors.accent}
                  maximumTrackTintColor={themeColors.border}
                  thumbTintColor={themeColors.accent}
                />
              </View>

              {/* Melody Factor */}
              <View style={styles.settingItemRow}>
                <Text style={[styles.settingItemLabel, { color: themeColors.text, marginRight: 10 }]}>
                  Melody Velocity ({melodyFactor.toFixed(2)}x)
                </Text>
                <Slider
                  style={{ flex: 1, height: 40 }}
                  minimumValue={0.2}
                  maximumValue={2.0}
                  value={melodyFactor}
                  onValueChange={setMelodyFactor}
                  minimumTrackTintColor={themeColors.accent}
                  maximumTrackTintColor={themeColors.border}
                  thumbTintColor={themeColors.accent}
                />
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
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    alignItems: 'center',
  },
  jobInfo: {
    flex: 1,
  },
  jobFilename: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  jobMeta: {
    fontSize: 12,
    marginBottom: 8,
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
  }
});
