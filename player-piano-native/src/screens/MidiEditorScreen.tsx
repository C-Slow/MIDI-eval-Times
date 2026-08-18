import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  Switch,
  Pressable,
  PanResponder
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import { useStore } from '../store/useStore';
import { midiOrchestratorApi, pianoApi, mp3Api, playlistApi } from '../services/api';
import { Colors } from '../constants/Colors';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { setAudioMode } from '../services/audioMode';
import { useNavigation } from '@react-navigation/native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PIXELS_PER_SECOND = 40; // Timeline scale
const LANE_HEIGHT = 80;

const getPlaylistColor = (name: string) => {
  const colors = ['#4CAF50', '#2196F3', '#9C27B0', '#FF9800', '#E91E63', '#00BCD4', '#009688', '#FF5722', '#673AB7', '#3F51B5'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

const HoldableButton = ({ onPressAction, children, style, delayMs = 350, intervalMs = 90, ...props }: any) => {
  const timerRef = useRef<any>(null);
  const intervalRef = useRef<any>(null);
  const isHoldingRef = useRef(false);
  const actionRef = useRef(onPressAction);
  actionRef.current = onPressAction;

  const stopRepeat = React.useCallback(() => {
    isHoldingRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startRepeat = React.useCallback(() => {
    if (isHoldingRef.current) return;
    isHoldingRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    actionRef.current();
    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        actionRef.current();
      }, intervalMs);
    }, delayMs);
  }, [delayMs, intervalMs]);

  useEffect(() => {
    return () => stopRepeat();
  }, [stopRepeat]);

  return (
    <TouchableOpacity
      {...props}
      style={style}
      onPressIn={startRepeat}
      onPressOut={stopRepeat}
      onMouseDown={startRepeat}
      onMouseUp={stopRepeat}
      onMouseLeave={stopRepeat}
      onTouchStart={startRepeat}
      onTouchEnd={stopRepeat}
      onResponderRelease={stopRepeat}
      onResponderTerminate={stopRepeat}
    >
      {children}
    </TouchableOpacity>
  );
};

interface NoteGridProps {
  lanesData: any[];
  pianoTracks: Set<number>;
  speakerTracks: Set<number>;
  vocalMaleTracks: Set<number>;
  vocalFemaleTracks: Set<number>;
  themeColors: any;
  durationSec: number;
  timelineWidth: number;
  totalHeight: number;
  importedVocalsEnabled: boolean;
  importedVocalsDelayMs: number;
  vocalsWaveformEnvelope: number[] | null;
  importedVocalsBreaklines: any[];
  loopStartMs: number | null;
  loopEndMs: number | null;
  loopEnabled: boolean;
  laneOffsets: number[];
  laneHeights: number[];
  finetuneTimeMs: number | null;
  finetuneMode: 'breakline' | 'loopStart' | 'loopEnd' | null;
  visibleStartPx?: number;
  visibleEndPx?: number;
  onUpdateBreakline: (index: number, delta: number) => void;
  onDeleteBreakline: (index: number) => void;
  onDeleteLoopStart: () => void;
  onDeleteLoopEnd: () => void;
  onLongPressVocals: (locationX: number) => void;
}

const InstrumentLanesContent = React.memo(({
  lanesData,
  laneOffsets,
  laneHeights,
  themeColors,
  pianoTracks,
  speakerTracks,
  vocalMaleTracks,
  vocalFemaleTracks,
  visibleStartPx = 0,
  visibleEndPx = 3000,
}: any) => {
  const getTrackColor = (trackIndex: number, isPiano: boolean, isSpeaker: boolean, isMale: boolean, isFemale: boolean) => {
    if (isPiano) return themeColors.accent;
    if (isSpeaker) return '#a29bfe';
    if (isMale) return '#0984e3';
    if (isFemale) return '#e84393';
    return themeColors.textMuted;
  };
  const verticalPadding = 8;
  const usableLaneHeight = LANE_HEIGHT - (verticalPadding * 2);

  return (
    <>
      {lanesData.map((lane: any, laneIdx: number) => {
        if (lane.index === -99) return null;
        const topPos = laneOffsets[laneIdx];
        const currentLaneHeight = laneHeights[laneIdx];

        const isPiano = pianoTracks.has(lane.index);
        const isSpeaker = speakerTracks.has(lane.index);
        const isMale = vocalMaleTracks.has(lane.index);
        const isFemale = vocalFemaleTracks.has(lane.index);
        const color = getTrackColor(lane.index, isPiano, isSpeaker, isMale, isFemale);

        return (
          <View 
            key={lane.index} 
            style={[
              styles.laneTimeline, 
              { 
                height: currentLaneHeight, 
                top: topPos, 
                borderBottomColor: themeColors.border 
              }
            ]}
          >
            {lane.notes.map((note: any, noteIdx: number) => {
              const noteWidth = Math.max(2, (note.end - note.start) * PIXELS_PER_SECOND);
              const noteLeft = note.start * PIXELS_PER_SECOND;
              const noteRight = noteLeft + noteWidth;

              // Viewport Virtualization: Clip off-screen notes to prevent main thread freezing
              if (noteRight < visibleStartPx || noteLeft > visibleEndPx) {
                return null;
              }

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
    </>
  );
}, (prev, next) => {
  if (prev.visibleStartPx !== next.visibleStartPx) return false;
  if (prev.visibleEndPx !== next.visibleEndPx) return false;
  if (prev.lanesData !== next.lanesData) return false;
  if (prev.themeColors !== next.themeColors) return false;
  if (prev.pianoTracks !== next.pianoTracks) return false;
  if (prev.speakerTracks !== next.speakerTracks) return false;
  if (prev.vocalMaleTracks !== next.vocalMaleTracks) return false;
  if (prev.vocalFemaleTracks !== next.vocalFemaleTracks) return false;
  if (prev.laneOffsets.length !== next.laneOffsets.length) return false;
  for (let i = 0; i < prev.laneOffsets.length; i++) {
    if (prev.laneOffsets[i] !== next.laneOffsets[i]) return false;
    if (prev.laneHeights[i] !== next.laneHeights[i]) return false;
  }
  return true;
});

const NoteGrid = React.memo(({
  lanesData,
  pianoTracks,
  speakerTracks,
  vocalMaleTracks,
  vocalFemaleTracks,
  themeColors,
  durationSec,
  timelineWidth,
  totalHeight,
  importedVocalsEnabled,
  importedVocalsDelayMs,
  vocalsWaveformEnvelope,
  importedVocalsBreaklines,
  loopStartMs,
  loopEndMs,
  loopEnabled,
  laneOffsets,
  laneHeights,
  finetuneTimeMs,
  finetuneMode,
  visibleStartPx,
  visibleEndPx,
  onUpdateBreakline,
  onDeleteBreakline,
  onDeleteLoopStart,
  onDeleteLoopEnd,
  onLongPressVocals,
}: NoteGridProps) => {
  const verticalPadding = 8;
  const usableLaneHeight = LANE_HEIGHT - (verticalPadding * 2);

  const sortedBreaks = useMemo(() => {
    return [...(importedVocalsBreaklines || [])].sort((a, b) => a.time_ms - b.time_ms);
  }, [importedVocalsBreaklines]);

  return (
    <View style={{ width: timelineWidth, height: totalHeight, position: 'absolute', top: 0, left: 0 }}>
      {loopStartMs !== null && (
        <View 
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: (loopStartMs / 1000) * PIXELS_PER_SECOND,
            width: loopEndMs !== null ? Math.max(2, ((loopEndMs - loopStartMs) / 1000) * PIXELS_PER_SECOND) : 2,
            backgroundColor: loopEnabled ? 'rgba(46, 204, 113, 0.08)' : 'rgba(120, 120, 120, 0.08)',
            borderLeftWidth: 2,
            borderLeftColor: loopEnabled ? '#2ecc71' : themeColors.textMuted,
            borderRightWidth: loopEndMs !== null ? 2 : 0,
            borderRightColor: loopEnabled ? '#e74c3c' : themeColors.textMuted,
            zIndex: 9
          }}
        />
      )}

      {/* Finetune Marker Line */}
      {finetuneTimeMs !== null && finetuneMode !== null && (
        <View 
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: (finetuneTimeMs / 1000) * PIXELS_PER_SECOND,
            width: 2,
            backgroundColor: '#0984e3',
            zIndex: 20
          }}
        />
      )}

      {(importedVocalsBreaklines || []).map((breakline: any, idx: number) => {
        const left = (breakline.time_ms / 1000) * PIXELS_PER_SECOND;
        return (
          <View 
            key={`breakline-line-${idx}`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left,
              width: 1,
              borderStyle: 'dashed',
              borderWidth: 1.5,
              borderColor: '#e84393',
              zIndex: 10
            }}
          />
        );
      })}

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
        if (lane.index !== -99) return null;
        const topPos = laneOffsets[laneIdx];
        const currentLaneHeight = laneHeights[laneIdx];
        const waveformColor = importedVocalsEnabled ? '#e84393' : 'rgba(120, 120, 120, 0.4)';

        return (
          <View 
            key={lane.index} 
            style={[
              styles.laneTimeline, 
              { 
                height: currentLaneHeight, 
                top: topPos, 
                borderBottomColor: themeColors.border,
                backgroundColor: 'rgba(232, 67, 147, 0.05)'
              }
            ]}
          >
            {/* Pressable vocal lane area for long-press */}
            <Pressable
              onLongPress={(evt) => {
                onLongPressVocals(evt.nativeEvent.locationX);
              }}
              style={{ position: 'absolute', top: 0, left: 0, width: timelineWidth, height: 70 }}
            >
              <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                {vocalsWaveformEnvelope && vocalsWaveformEnvelope.length > 0 ? (
                  vocalsWaveformEnvelope.map((val: number, idx: number) => {
                    const tMs = idx * 100; // 10 points per sec = 100ms per point
                    
                    // Compute dynamic segment offset based on audio boundaries
                    let offsetMs = importedVocalsDelayMs;
                    if (sortedBreaks.length > 0) {
                      for (const b of sortedBreaks) {
                        const audioBoundary = b.time_ms - offsetMs;
                        if (tMs > audioBoundary) {
                          offsetMs = b.offset_ms;
                        } else {
                          break;
                        }
                      }
                    }
                    
                    const delayOffsetPx = (offsetMs / 1000) * PIXELS_PER_SECOND;
                    const left = idx * 0.1 * PIXELS_PER_SECOND + delayOffsetPx;
                    if (left < -10 || left > timelineWidth + 10) return null;
                    
                    // Center waveform in top 70px envelope region
                    const barHeight = Math.max(2, val * (70 - verticalPadding * 2));
                    const barTop = verticalPadding + ((70 - verticalPadding * 2) - barHeight) / 2;
                    
                    return (
                      <View
                        key={idx}
                        style={{
                          position: 'absolute',
                          left,
                          width: Math.max(1, 0.1 * PIXELS_PER_SECOND - 1),
                          top: barTop,
                          height: barHeight,
                          backgroundColor: waveformColor,
                          borderRadius: 1
                        }}
                      />
                    );
                  })
                ) : (
                  <Text style={{ position: 'absolute', left: 20, top: 25, fontSize: 11, color: themeColors.textMuted, fontStyle: 'italic' }}>
                    No waveform data loaded. Long-press here to place markers.
                  </Text>
                )}
              </View>
            </Pressable>

            {/* Inline Breakline Alignment Controllers in the bottom 50px of expanded lane */}
            {sortedBreaks.map((b, index) => {
              const left = (b.time_ms / 1000) * PIXELS_PER_SECOND;
              
              return (
                <View
                  key={`inline-ctrl-${index}`}
                  style={{
                    position: 'absolute',
                    left: left - 65, // Center the 130px wide controller row
                    width: 130,
                    top: 72,
                    height: 44,
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(30, 30, 30, 0.9)',
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: '#e84393',
                    zIndex: 100,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.25,
                    shadowRadius: 3.84,
                    elevation: 5,
                  }}
                >
                  <Text style={{ fontSize: 9, color: '#fff', fontWeight: 'bold', marginBottom: 2 }}>
                    {b.offset_ms >= 0 ? `+${b.offset_ms}` : b.offset_ms} ms
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {/* Decrements */}
                    {[-50, -10].map(val => (
                      <HoldableButton
                        key={`bctrl-${val}`}
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.15)',
                          paddingHorizontal: 4,
                          paddingVertical: 2,
                          borderRadius: 3
                        }}
                        onPressAction={() => onUpdateBreakline(index, val)}
                      >
                        <Text style={{ color: '#fff', fontSize: 8 }}>{val}</Text>
                      </HoldableButton>
                    ))}

                    {/* Delete Breakline button */}
                    <TouchableOpacity
                      style={{
                        backgroundColor: '#e74c3c',
                        paddingHorizontal: 5,
                        paddingVertical: 2,
                        borderRadius: 3
                      }}
                      onPress={() => onDeleteBreakline(index)}
                    >
                      <Ionicons name="close" size={10} color="#fff" />
                    </TouchableOpacity>

                    {/* Increments */}
                    {[10, 50].map(val => (
                      <HoldableButton
                        key={`bctrl-${val}`}
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.15)',
                          paddingHorizontal: 4,
                          paddingVertical: 2,
                          borderRadius: 3
                        }}
                        onPressAction={() => onUpdateBreakline(index, val)}
                      >
                        <Text style={{ color: '#fff', fontSize: 8 }}>{`+${val}`}</Text>
                      </HoldableButton>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}

      <InstrumentLanesContent
        lanesData={lanesData}
        laneOffsets={laneOffsets}
        laneHeights={laneHeights}
        themeColors={themeColors}
        pianoTracks={pianoTracks}
        speakerTracks={speakerTracks}
        vocalMaleTracks={vocalMaleTracks}
        vocalFemaleTracks={vocalFemaleTracks}
        visibleStartPx={visibleStartPx}
        visibleEndPx={visibleEndPx}
      />
    </View>
  );
}, (prevProps, nextProps) => {
  if (prevProps.visibleStartPx !== nextProps.visibleStartPx) return false;
  if (prevProps.visibleEndPx !== nextProps.visibleEndPx) return false;
  if (prevProps.timelineWidth !== nextProps.timelineWidth) return false;
  if (prevProps.totalHeight !== nextProps.totalHeight) return false;
  if (prevProps.durationSec !== nextProps.durationSec) return false;
  if (prevProps.themeColors !== nextProps.themeColors) return false;
  if (prevProps.lanesData !== nextProps.lanesData) return false;
  if (prevProps.importedVocalsEnabled !== nextProps.importedVocalsEnabled) return false;
  if (prevProps.importedVocalsDelayMs !== nextProps.importedVocalsDelayMs) return false;
  if (prevProps.vocalsWaveformEnvelope !== nextProps.vocalsWaveformEnvelope) return false;
  if (prevProps.importedVocalsBreaklines !== nextProps.importedVocalsBreaklines) return false;
  if (prevProps.loopStartMs !== nextProps.loopStartMs) return false;
  if (prevProps.loopEndMs !== nextProps.loopEndMs) return false;
  if (prevProps.loopEnabled !== nextProps.loopEnabled) return false;
  if (prevProps.finetuneTimeMs !== nextProps.finetuneTimeMs) return false;
  if (prevProps.finetuneMode !== nextProps.finetuneMode) return false;
  
  if (prevProps.laneOffsets.length !== nextProps.laneOffsets.length) return false;
  if (prevProps.laneHeights.length !== nextProps.laneHeights.length) return false;
  for (let i = 0; i < prevProps.laneOffsets.length; i++) {
    if (prevProps.laneOffsets[i] !== nextProps.laneOffsets[i]) return false;
    if (prevProps.laneHeights[i] !== nextProps.laneHeights[i]) return false;
  }

  if (prevProps.pianoTracks.size !== nextProps.pianoTracks.size) return false;
  if (prevProps.speakerTracks.size !== nextProps.speakerTracks.size) return false;
  if (prevProps.vocalMaleTracks.size !== nextProps.vocalMaleTracks.size) return false;
  if (prevProps.vocalFemaleTracks.size !== nextProps.vocalFemaleTracks.size) return false;
  
  for (const item of prevProps.pianoTracks) {
    if (!nextProps.pianoTracks.has(item)) return false;
  }
  for (const item of prevProps.speakerTracks) {
    if (!nextProps.speakerTracks.has(item)) return false;
  }
  for (const item of prevProps.vocalMaleTracks) {
    if (!nextProps.vocalMaleTracks.has(item)) return false;
  }
  for (const item of prevProps.vocalFemaleTracks) {
    if (!nextProps.vocalFemaleTracks.has(item)) return false;
  }
  
  return true;
});

const JobCardItem = React.memo(({ 
  item, 
  isSelected, 
  themeColors, 
  getCleanTitle, 
  getPlaylistColor, 
  getSongLength, 
  renderStars, 
  onPress, 
  onLongPress, 
  onLogPress 
}: any) => {
  return (
    <TouchableOpacity 
      style={[
        styles.jobCard, 
        isSelected && { backgroundColor: themeColors.accentLight }, 
        { borderBottomColor: themeColors.border }
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
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
              <View key={pl} style={[styles.statusTag, { backgroundColor: getPlaylistColor(pl) }]}>
                <Text style={styles.statusTagText}>{pl.substring(0, 4).toUpperCase()}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Row 2: Artist */}
        <Text style={{ fontSize: 11, color: item.artist ? themeColors.accent : themeColors.textMuted, fontWeight: '600', marginTop: -2 }} numberOfLines={1}>
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

          {/* Validated Badge */}
          {(item.validated === true || item.validated === 'true' || item.validated === 1) && (
            <View style={[styles.statBadge, { backgroundColor: 'rgba(46, 204, 113, 0.15)' }]}>
              <Text style={[styles.statBadgeText, { color: '#2ecc71', fontWeight: 'bold' }]}>V</Text>
            </View>
          )}

          {/* DNU Badge */}
          {(item.dnu === true || item.dnu === 'true' || item.dnu === 1) && (
            <View style={[styles.statBadge, { backgroundColor: 'rgba(231, 76, 60, 0.15)' }]}>
              <Text style={[styles.statBadgeText, { color: '#e74c3c' }]}>DNU</Text>
            </View>
          )}

          {/* Comments Badge */}
          {!!(item.comments && item.comments.trim()) && (
            <View style={[styles.statBadge, { backgroundColor: 'rgba(52, 152, 219, 0.15)', paddingHorizontal: 6, paddingVertical: 2 }]}>
              <Ionicons name="chatbox-ellipses-outline" size={12} color="#3498db" />
            </View>
          )}

          {/* Synthesis Successful Green Checkmark */}
          {item.status === 'completed' && (
            <View style={{ marginLeft: 4, paddingHorizontal: 2, paddingVertical: 2, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="checkmark-circle" size={15} color="#2ecc71" />
            </View>
          )}
        </View>

        {/* Progress details */}
        {(item.status === 'processing' || item.status === 'synthesizing' || item.status?.includes('synthesizing') || item.status?.includes('mixing')) && (
          <View style={[styles.progressContainer, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <View style={[styles.progressBarBg, { backgroundColor: themeColors.surfaceSecondary }]}>
                <View style={[styles.progressBarFill, { width: `${item.progress || 0}%`, backgroundColor: themeColors.accent }]} />
              </View>
              <Text style={[styles.progressText, { color: themeColors.textMuted }]}>
                {`Processing (${item.progress || 0}%)`}
              </Text>
            </View>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: themeColors.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: themeColors.border }}
              onPress={onLogPress}
            >
              <Ionicons name="terminal-outline" size={14} color={themeColors.accent} style={{ marginRight: 4 }} />
              <Text style={{ fontSize: 10, color: themeColors.text, fontWeight: 'bold' }}>Logs</Text>
            </TouchableOpacity>
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
    </TouchableOpacity>
  );
}, (prev, next) => {
  return (
    prev.isSelected === next.isSelected &&
    prev.themeColors === next.themeColors &&
    prev.item.job_id === next.item.job_id &&
    prev.item.status === next.item.status &&
    prev.item.progress === next.item.progress &&
    prev.item.rating === next.item.rating &&
    prev.item.validated === next.item.validated &&
    prev.item.dnu === next.item.dnu &&
    prev.item.filename === next.item.filename &&
    prev.item.artist === next.item.artist &&
    JSON.stringify(prev.item.playlists) === JSON.stringify(next.item.playlists)
  );
});

const ARTICULATIONS_BY_CATEGORY: Record<string, Array<{ id: string; label: string }>> = {
  Strings: [
    { id: 'auto', label: 'Auto Detect' },
    { id: 'legato', label: 'Legato (Smooth)' },
    { id: 'long', label: 'Long (Arco / Bowed)' },
    { id: 'con_sordino', label: 'Long CS (Muted)' },
    { id: 'flautando', label: 'Long Flautando (Whispery)' },
    { id: 'spiccato', label: 'Spiccato (Bouncing)' },
    { id: 'staccato', label: 'Staccato (Crisp Short)' },
    { id: 'pizzicato', label: 'Pizzicato (Plucked)' },
    { id: 'col_legno', label: 'Col Legno (Wood of Bow)' },
    { id: 'tremolo', label: 'Tremolo (Rapid Bowing)' },
    { id: 'trill_maj2', label: 'Trill Major 2nd' },
    { id: 'trill_min2', label: 'Trill Minor 2nd' },
    { id: 'sul_tasto', label: 'Long Sul Tasto (Soft Fingerboard)' },
    { id: 'harmonics', label: 'Long Harmonics (Bell-like)' },
    { id: 'short_harmonics', label: 'Short Harmonics' },
    { id: 'bartok_pizz', label: 'Bartók Pizz (Snap Pluck)' },
    { id: 'marcato_attack', label: 'Long Marcato Attack' },
    { id: 'tremolo_sul_pont', label: 'Tremolo Sul Pont (Near Bridge)' },
    { id: 'tremolo_cs', label: 'Tremolo CS (Muted Tremolo)' },
    { id: 'sul_pont', label: 'Long Sul Pont (Metallic Bridge)' },
    { id: 'spiccato_cs', label: 'Spiccato CS (Muted Spiccato)' },
  ],
  Brass: [
    { id: 'auto', label: 'Auto Detect' },
    { id: 'legato', label: 'Legato (Extended Smooth)' },
    { id: 'long', label: 'Long (Sustained)' },
    { id: 'staccatissimo', label: 'Staccatissimo (Ultra Short)' },
    { id: 'marcato', label: 'Marcato (Accented)' },
    { id: 'long_cuivre', label: 'Long Cuivre (Brassy Power)' },
    { id: 'long_sfz', label: 'Long SFZ (Sforzando)' },
    { id: 'long_flutter', label: 'Long Flutter (Flutter Tongue)' },
    { id: 'multi_tongue', label: 'Multi-Tongue (Rapid)' },
    { id: 'trill_maj2', label: 'Trill Major 2nd' },
    { id: 'trill_min2', label: 'Trill Minor 2nd' },
    { id: 'con_sordino', label: 'Long Muted (Con Sordino)' },
    { id: 'staccatissimo_muted', label: 'Staccatissimo Muted' },
    { id: 'marcato_muted', label: 'Marcato Muted' },
  ],
  Woodwind: [
    { id: 'auto', label: 'Auto Detect' },
    { id: 'legato', label: 'Legato (Smooth)' },
    { id: 'long', label: 'Long (Sustained)' },
    { id: 'staccatissimo', label: 'Staccatissimo (Short)' },
    { id: 'staccato', label: 'Staccato (Detached)' },
    { id: 'tenuto', label: 'Tenuto (Held Length)' },
    { id: 'marcato', label: 'Marcato (Accented)' },
    { id: 'trill_maj2', label: 'Trill Major 2nd' },
    { id: 'trill_min2', label: 'Trill Minor 2nd' },
    { id: 'long_flutter', label: 'Long Flutter (Flutter Tongue)' },
    { id: 'multi_tongue', label: 'Multi-Tongue (Rapid)' },
    { id: 'rips', label: 'Rips (Upward Slide)' },
    { id: 'falls', label: 'Falls (Downward Drop)' },
  ],
  Percussion: [
    { id: 'auto', label: 'Auto Detect' },
    { id: 'anvil', label: 'Anvil (Steel Strike)' },
    { id: 'bass_drum_1', label: 'Bass Drum 1 (Concert Kick)' },
    { id: 'bass_drum_2', label: 'Bass Drum 2 (Tight Kick)' },
    { id: 'cymbal', label: 'Cymbal (Crash / Ride / Hi-Hat)' },
    { id: 'military_drum', label: 'Military Drum (March Snare)' },
    { id: 'piatti', label: 'Piatti (Crash Cymbals)' },
    { id: 'snare_1', label: 'Snare 1 (Concert Snare)' },
    { id: 'snare_2', label: 'Snare 2 (Field Drum)' },
    { id: 'tam_tam', label: 'Tam Tam (Concert Gong)' },
    { id: 'tambourine', label: 'Tambourine (Shake & Slap)' },
    { id: 'tenor_drum', label: 'Tenor Drum (Toms)' },
    { id: 'toys', label: 'Toys (Castanets / Shaker)' },
    { id: 'triangle', label: 'Triangle (Chime)' },
    { id: 'hits', label: 'Hits (Standard Strike)' },
    { id: 'rolls', label: 'Rolls (Sustained Tremolo)' },
    { id: 'hits_soft', label: 'Hits Soft (Felt Mallet)' },
    { id: 'rolls_soft', label: 'Rolls Soft (Swelling Roll)' },
    { id: 'hits_hotrods', label: 'Hits Hotrods (Birch Dowels)' },
    { id: 'rolls_hotrods', label: 'Long Rolls Hotrods' },
    { id: 'hits_damped', label: 'Hits Damped (Muffled)' },
    { id: 'hits_super_damped', label: 'Hits Super Damped (Choked)' },
    { id: 'hotrods_hits_damped', label: 'Hotrods Hits Damped' },
    { id: 'hits_damped_soft', label: 'Hits Damped Soft' },
    { id: 'sustained', label: 'Harp Sustained (Ring Out)' },
    { id: 'damped', label: 'Harp Damped (Muted)' },
    { id: 'damped_medium', label: 'Harp Damped Medium' },
    { id: 'bisbigliando', label: 'Bisbigliando (Whispering Tremolo)' },
    { id: 'gliss_fx', label: 'Glissando FX (Sweeping Gliss)' },
    { id: 'bowed', label: 'Bowed (Ethereal Glassy)' },
  ],
  Choir: [
    { id: 'auto', label: 'Auto Detect' },
    { id: 'long_ahh', label: 'Long Ahh (Open Vowel)' },
    { id: 'long_mmm', label: 'Long Mmm (Humming)' },
    { id: 'long_episodic_1', label: 'Episodic Combo 1' },
    { id: 'long_episodic_2', label: 'Episodic Combo 2' },
    { id: 'staccato_syllables', label: 'Staccato Syllables' },
    { id: 'staccato_syllables_keyswitch', label: 'Staccato Syllables (Keyswitch)' },
  ],
  Saxophones: [
    { id: 'auto', label: 'Auto Detect' },
    { id: 'long', label: 'Long (Sustained Drama)' },
    { id: 'soft', label: 'Soft (Gentle Breath)' },
    { id: 'growl', label: 'Growl (Throaty Rasp)' },
    { id: 'chatter', label: 'Chatter (Rhythmic Movement)' },
    { id: 'layered_chatter', label: 'Layered Chatter (Cluster)' },
    { id: 'perf', label: 'Performance (Dynamic Legato)' },
    { id: 'soft_perf', label: 'Soft Performance' },
    { id: 'rounded_short', label: 'Rounded Short (Mellow Staccato)' },
  ],
  Recorders: [
    { id: 'auto', label: 'Auto Detect' },
    { id: 'long', label: 'Long (Straight Tone)' },
    { id: 'soft', label: 'Soft (Feathered Air)' },
    { id: 'bend_vib', label: 'Bend Vibrato (Expressive)' },
    { id: 'chiff', label: 'Chiff (Short Breathy Attack)' },
    { id: 'flutter', label: 'Flutter Tongue' },
    { id: 'layered_flutter', label: 'Layered Flutter' },
    { id: 'perf', label: 'Performance (Dynamic Legato)' },
    { id: 'rounded_short', label: 'Rounded Short (Clean Short)' },
  ],
  Guitar: [
    { id: 'auto', label: 'Auto Detect' },
    { id: 'long', label: 'Sustained (Plucked / Strummed)' },
    { id: 'staccato', label: 'Muted / Staccato' },
    { id: 'harmonics', label: 'Harmonics' },
  ],
  Synth: [
    { id: 'auto', label: 'Auto Detect' },
    { id: 'long', label: 'Sustained Pad / Lead' },
    { id: 'staccato', label: 'Short Staccato / Pluck' },
  ]
};

export const MidiEditorScreen = () => {
  const theme = useStore(state => state.theme);
  const themeColors = Colors[theme];
  const navigation = useNavigation();
  const isPianoConnected = useStore(state => state.isPianoConnected);
  const globalOffset = useStore(state => state.midiOrchestrateOffset);
  const setGlobalOffset = useStore(state => state.setMidiOrchestrateOffset);
  const setSystemBusy = useStore(state => state.setSystemBusy);
  const playlists = useStore(state => state.playlists);
  const setPlaylists = useStore(state => state.setPlaylists);

  // Screen Stages: 'list' | 'visualizer'
  const [stage, setStage] = useState<'list' | 'visualizer'>('list');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  
  // Track configuration state
  const [pianoTracks, setPianoTracks] = useState<Set<number>>(new Set());
  const [speakerTracks, setSpeakerTracks] = useState<Set<number>>(new Set());
  const [vocalMaleTracks, setVocalMaleTracks] = useState<Set<number>>(new Set());
  const [vocalFemaleTracks, setVocalFemaleTracks] = useState<Set<number>>(new Set());
  const [pedalPreset, setPedalPreset] = useState<'light' | 'medium' | 'full'>('light');
  const [rhythmFactor, setRhythmFactor] = useState(1.0);
  const [melodyFactor, setMelodyFactor] = useState(1.0);

  // Imported MP3 Vocals State
  const [importedVocalsJobId, setImportedVocalsJobId] = useState<string | null>(null);
  const [importedVocalsOriginalName, setImportedVocalsOriginalName] = useState<string | null>(null);
  const [importedVocalsDelayMs, setImportedVocalsDelayMs] = useState<number>(0);
  const [importedVocalsEnabled, setImportedVocalsEnabled] = useState<boolean>(true);
  const [importedVocalsVolumeFactor, setImportedVocalsVolumeFactor] = useState<number>(1.0);
  const [importedVocalsBreaklines, setImportedVocalsBreaklines] = useState<any[]>([]);

  // Looping Playback State
  const [loopStartMs, setLoopStartMs] = useState<number | null>(null);
  const [loopEndMs, setLoopEndMs] = useState<number | null>(null);
  const [loopEnabled, setLoopEnabled] = useState<boolean>(false);
  const [vocalsWaveformEnvelope, setVocalsWaveformEnvelope] = useState<number[] | null>(null);
  const [mp3Jobs, setMp3Jobs] = useState<any[]>([]);
  const [showMp3ImportModal, setShowMp3ImportModal] = useState(false);

  // Drag reordering state for MP3 Vocals track
  const [mp3VocalsPosition, setMp3VocalsPosition] = useState<number | null>(null);
  const [isDraggingMp3Vocals, setIsDraggingMp3Vocals] = useState<boolean>(false);

  // Viewport Virtualization state for large MIDI songs
  const [visibleScrollX, setVisibleScrollX] = useState<number>(0);
  const visibleStartPx = Math.max(0, visibleScrollX - (SCREEN_WIDTH * 2));
  const visibleEndPx = visibleScrollX + (SCREEN_WIDTH * 3);

  const handleTimelineScroll = React.useCallback((event: any) => {
    const x = event.nativeEvent.contentOffset.x;
    const chunk = Math.floor(x / 250);
    setVisibleScrollX(prev => {
      const prevChunk = Math.floor(prev / 250);
      return chunk !== prevChunk ? x : prev;
    });
  }, []);

  const dragStartYRef = useRef<number>(0);
  const mp3StartPosRef = useRef<number>(0);
  const longPressTimerRef = useRef<any>(null);

  const loopConfigRef = useRef({ enabled: false, start: null as number | null, end: null as number | null });
  useEffect(() => {
    loopConfigRef.current = { enabled: loopEnabled, start: loopStartMs, end: loopEndMs };
  }, [loopEnabled, loopStartMs, loopEndMs]);

  // Keep Awake during active playing
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    const currentlyPlaying = isPlaying || isPreviewPlaying;
    if (currentlyPlaying !== wasPlayingRef.current) {
      wasPlayingRef.current = currentlyPlaying;
      if (currentlyPlaying) {
        activateKeepAwakeAsync().catch(err => console.error('Failed to activate keep awake', err));
      } else {
        deactivateKeepAwake().catch(err => console.error('Failed to deactivate keep awake', err));
      }
    }
    return () => {
      if (wasPlayingRef.current) {
        deactivateKeepAwake().catch(() => {});
      }
    };
  }, [isPlaying, isPreviewPlaying]);

  // Tooltip & Finetuning States
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipTimeMs, setTooltipTimeMs] = useState(0);
  const [finetuneMode, setFinetuneMode] = useState<'breakline' | 'loopStart' | 'loopEnd' | null>(null);
  const [finetuneTimeMs, setFinetuneTimeMs] = useState(0);

  // Settings Panel visibility
  const [showSettings, setShowSettings] = useState(false);

  // Backend Audio / Speaker states
  const backendAudioEnabled = useStore(state => state.backendAudioEnabled);
  const setBackendAudioEnabled = useStore(state => state.setBackendAudioEnabled);
  const backendAudioVolume = useStore(state => state.backendAudioVolume);
  const setBackendAudioVolume = useStore(state => state.setBackendAudioVolume);
  const selectedDevice = useStore(state => state.selectedDevice);
  const setSelectedDevice = useStore(state => state.setSelectedDevice);
  const [audioDevices, setAudioDevices] = useState<any[]>([]);

  // SoundFont & DSP Audio Quality states
  const [soundfonts, setSoundfonts] = useState<string[]>([]);
  const [activeSoundfont, setActiveSoundfont] = useState<string>('SGM-V2.01.sf2');
  const [reverbEnabled, setReverbEnabled] = useState<boolean>(true);
  const [reverbRoomSize, setReverbRoomSize] = useState<number>(0.75);
  const [reverbPresets, setReverbPresets] = useState<{ id: string; filename: string; title: string }[]>([]);
  const [selectedReverbPreset, setSelectedReverbPreset] = useState<string>('AIR Studios Reverb Essentials - Intimate Close.vstpreset');
  const [isUpdatingReverb, setIsUpdatingReverb] = useState<boolean>(false);

  const [peakCeilingDb, setPeakCeilingDb] = useState<number>(-6.0);
  const [fullPreviewMode, setFullPreviewMode] = useState<boolean>(false);

  // Track Settings & Customization states
  const [tracksConfig, setTracksConfig] = useState<Record<string, any>>({});
  const [editingTrackIndex, setEditingTrackIndex] = useState<number | null>(null);

  const pianoPlayback = useStore(state => state.pianoPlayback);
  const pianoStartedRef = useRef(false);

  useEffect(() => {
    if (pianoPlayback.isPlaying) {
      pianoStartedRef.current = true;
    }
  }, [pianoPlayback.isPlaying]);

  // If the piano stops playing, stop our local editor playback
  useEffect(() => {
    if (isPlaying) {
      if (!pianoPlayback.isPlaying && pianoStartedRef.current) {
        console.log('MIDI Editor: Detected piano stopped playing, stopping local playback...');
        stopPlayback();
      }
    } else {
      pianoStartedRef.current = false;
    }
  }, [pianoPlayback.isPlaying, isPlaying]);

  // Load backend audio settings on mount
  useEffect(() => {
    const initSettings = async () => {
      try {
        const data = await midiOrchestratorApi.getAudioSettings();
        setBackendAudioEnabled(data.backend_audio_enabled);
        setSelectedDevice(data.selected_device);
        setBackendAudioVolume(data.backend_audio_volume ?? 1.0);
        if (data.active_soundfont && !selectedJobId) setActiveSoundfont(data.active_soundfont);
        if (data.reverb_enabled !== undefined && !selectedJobId) setReverbEnabled(data.reverb_enabled);
        if (data.reverb_room_size !== undefined && !selectedJobId) setReverbRoomSize(data.reverb_room_size);
        if (data.peak_ceiling_db !== undefined && !selectedJobId) setPeakCeilingDb(data.peak_ceiling_db);
      } catch (err) {
        console.error('Failed to fetch backend audio settings', err);
      }
    };
    initSettings();
  }, [setBackendAudioEnabled, setBackendAudioVolume]);

  // Fetch devices, soundfonts and reverb presets when settings panel is opened
  useEffect(() => {
    if (editingTrackIndex !== null || showSettings) {
      midiOrchestratorApi.getVstPresets()
        .then(res => setVstCategories(res.categories || {}))
        .catch(e => console.log('Failed to fetch VST presets', e));
      midiOrchestratorApi.getReverbPresets()
        .then(res => {
          if (res && res.presets) {
            setReverbPresets(res.presets);
          }
        })
        .catch(e => console.log('Failed to fetch Reverb presets', e));
    }
  }, [editingTrackIndex, showSettings]);

  useEffect(() => {
    if (showSettings) {
      const fetchDevicesAndSoundfonts = async () => {
        try {
          const [devicesRes, sfRes] = await Promise.all([
            midiOrchestratorApi.getAudioDevices(),
            midiOrchestratorApi.getSoundfonts()
          ]);
          setAudioDevices(devicesRes.devices || []);
          if (sfRes.soundfonts) setSoundfonts(sfRes.soundfonts);
          if (sfRes.active_soundfont && !selectedJobId) setActiveSoundfont(sfRes.active_soundfont);
        } catch (err) {
          console.error('Failed to fetch audio devices or soundfonts', err);
        }
      };
      fetchDevicesAndSoundfonts();
    }
  }, [showSettings]);

  const handleSelectSoundfont = async (sf: string) => {
    setActiveSoundfont(sf);
    try {
      if (selectedJobId) {
        await midiOrchestratorApi.updateMetadata(selectedJobId, { soundfont: sf });
        setJobs(prevJobs => prevJobs.map(j => j.job_id === selectedJobId ? { ...j, soundfont: sf } : j));
      } else {
        await midiOrchestratorApi.saveAudioSettings(backendAudioEnabled, selectedDevice, backendAudioVolume, {
          active_soundfont: sf,
          reverb_enabled: reverbEnabled,
          reverb_room_size: reverbRoomSize,
          peak_ceiling_db: peakCeilingDb
        });
      }
    } catch (err) {
      console.error('Failed to save soundfont setting', err);
    }
  };

  const handleToggleReverb = async (enabled: boolean) => {
    setReverbEnabled(enabled);
    try {
      if (selectedJobId) {
        await midiOrchestratorApi.updateMetadata(selectedJobId, { reverb_enabled: enabled });
      }
      await midiOrchestratorApi.saveAudioSettings(backendAudioEnabled, selectedDevice, backendAudioVolume, {
        active_soundfont: activeSoundfont,
        reverb_enabled: enabled,
        reverb_room_size: reverbRoomSize,
        peak_ceiling_db: peakCeilingDb
      });
    } catch (err) {
      console.error('Failed to save reverb setting', err);
    }
  };

  const handleUpdateReverbPreset = async (presetFilename: string) => {
    setSelectedReverbPreset(presetFilename);
    if (!selectedJobId) return;

    const runningJob = jobs.find(j => (j.status === 'processing' || j.status === 'synthesizing' || j.status?.includes('synthesizing')));
    if (runningJob) {
      setActiveRunningJob(runningJob);
      setShowConflictModal(true);
      return;
    }

    setIsUpdatingReverb(true);
    try {
      const res = await midiOrchestratorApi.applyReverb(selectedJobId, presetFilename, true);
      console.log('Applied reverb preset to backing file:', res);
      const jobList = await midiOrchestratorApi.getJobs();
      setJobs(jobList);
    } catch (err) {
      console.error('Failed to update reverb preset for backing file', err);
    } finally {
      setIsUpdatingReverb(false);
    }
  };

  const handleChangeReverbRoomSize = async (size: number) => {
    setReverbRoomSize(size);
    try {
      if (selectedJobId) {
        await midiOrchestratorApi.updateMetadata(selectedJobId, { reverb_room_size: size });
      }
      await midiOrchestratorApi.saveAudioSettings(backendAudioEnabled, selectedDevice, backendAudioVolume, {
        active_soundfont: activeSoundfont,
        reverb_enabled: reverbEnabled,
        reverb_room_size: size,
        peak_ceiling_db: peakCeilingDb
      });
    } catch (err) {
      console.error('Failed to save reverb room size setting', err);
    }
  };

  const handleChangePeakCeiling = async (db: number) => {
    setPeakCeilingDb(db);
    try {
      if (selectedJobId) {
        await midiOrchestratorApi.updateMetadata(selectedJobId, { peak_ceiling_db: db });
      }
      await midiOrchestratorApi.saveAudioSettings(backendAudioEnabled, selectedDevice, backendAudioVolume, {
        active_soundfont: activeSoundfont,
        reverb_enabled: reverbEnabled,
        reverb_room_size: reverbRoomSize,
        peak_ceiling_db: db
      });
    } catch (err) {
      console.error('Failed to save peak ceiling setting', err);
    }
  };

  const handleToggleBackendAudio = async (enabled: boolean) => {
    setBackendAudioEnabled(enabled);
    try {
      if (enabled) {
        await midiOrchestratorApi.saveAudioSettings(true, selectedDevice, backendAudioVolume);
        if (selectedDevice) {
          await midiOrchestratorApi.connectBluetoothDevice(selectedDevice);
        }
      } else {
        await midiOrchestratorApi.saveAudioSettings(false, selectedDevice, backendAudioVolume);
        await midiOrchestratorApi.disconnectBluetoothDevice();
      }
    } catch (err: any) {
      console.error('Error toggling backend audio', err);
      Alert.alert('Settings Error', `Failed to apply backend audio settings: ${err.message}`);
    }
  };

  const handleSelectDevice = async (device: string) => {
    setSelectedDevice(device);
    try {
      await midiOrchestratorApi.saveAudioSettings(backendAudioEnabled, device, backendAudioVolume);
      if (backendAudioEnabled && device) {
        await midiOrchestratorApi.connectBluetoothDevice(device);
      }
    } catch (err: any) {
      console.error('Error selecting device', err);
      Alert.alert('Connection Error', `Failed to connect device: ${err.message}`);
    }
  };

  const handleVolumeChange = async (vol: number) => {
    setBackendAudioVolume(vol);
    try {
      await midiOrchestratorApi.setVolume(vol);
    } catch (err) {
      console.error('Failed to set volume', err);
    }
  };

  // Playback / Visualizer State
  const [notes, setNotes] = useState<Record<string, any[]>>({});
  const [playbackPos, setPlaybackPos] = useState(0); // in ms
  const [playbackDuration, setPlaybackDuration] = useState(0); // in ms
  const soundRef = useRef<Audio.Sound | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const playbackTimerRef = useRef<any>(null);
  const isSeekingRef = useRef(false);

  // Preview State
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [vstCategories, setVstCategories] = useState<Record<string, Array<{ id: string; filename: string; title: string; category: string }>>>({});
  const [selectedVstCategory, setSelectedVstCategory] = useState<string>('Auto');

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
  const [detailsValidated, setDetailsValidated] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [playbackMode, setPlaybackMode] = useState<'preview' | 'performance'>('preview');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'artist' | 'rating' | 'created' | 'length'>('created');
  const previewSoundRef = useRef<Audio.Sound | null>(null);

  const [showWorkerLogModal, setShowWorkerLogModal] = useState(false);
  const [workerLogText, setWorkerLogText] = useState('');
  const [isFetchingWorkerLog, setIsFetchingWorkerLog] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [activeRunningJob, setActiveRunningJob] = useState<any>(null);
  const [playlistModal, setPlaylistModal] = useState<{ visible: boolean; newPlaylistName: string }>({ visible: false, newPlaylistName: '' });

  useEffect(() => {
    if (!showWorkerLogModal || !selectedJobId) return;
    let isMounted = true;
    const fetchLog = async () => {
      try {
        setIsFetchingWorkerLog(true);
        const res = await midiOrchestratorApi.getWorkerLog(selectedJobId);
        if (isMounted) setWorkerLogText(res.log || 'No log text recorded yet.');
      } catch (e) {
        if (isMounted) setWorkerLogText('Error loading worker log.');
      } finally {
        if (isMounted) setIsFetchingWorkerLog(false);
      }
    };
    fetchLog();
    const interval = setInterval(fetchLog, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [showWorkerLogModal, selectedJobId]);

  const toggleSelect = (jobId: string) => {
    setSelectedJobs(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const getActiveTrackCategory = (): string => {
    if (editingTrackIndex === null) return 'Strings';
    const curPatch = (tracksConfig[String(editingTrackIndex)]?.instrument_patch || 'auto').toLowerCase();
    if (curPatch !== 'auto') {
      if (curPatch.includes('violin') || curPatch.includes('viola') || curPatch.includes('cell') || (curPatch.includes('bass') && !curPatch.includes('sax') && !curPatch.includes('drum') && !curPatch.includes('tromb') && !curPatch.includes('woodwind'))) {
        return curPatch.includes('tromb') ? 'Brass' : 'Strings';
      }
      if (curPatch.includes('trumpet') || curPatch.includes('horn') || curPatch.includes('tromb') || curPatch.includes('tuba') || curPatch.includes('flugel')) {
        return 'Brass';
      }
      if (curPatch.includes('flute') || curPatch.includes('piccolo') || curPatch.includes('oboe') || curPatch.includes('clarinet') || curPatch.includes('bassoon') || curPatch.includes('cor_anglais')) {
        return 'Woodwind';
      }
      if (curPatch.includes('alto_sax') || curPatch.includes('bass_sax') || curPatch.includes('sax')) {
        return 'Saxophones';
      }
      if (curPatch.includes('recorder')) {
        return 'Recorders';
      }
      if (curPatch.includes('choir')) {
        return 'Choir';
      }
      if (curPatch.includes('percussion') || curPatch.includes('drum') || curPatch.includes('timpani') || curPatch.includes('harp') || curPatch.includes('marimba') || curPatch.includes('xylophone') || curPatch.includes('glockenspiel') || curPatch.includes('celeste') || curPatch.includes('crotales') || curPatch.includes('bells') || curPatch.includes('tubular') || curPatch.includes('vibraphone') || curPatch.includes('cymbal') || curPatch.includes('snare') || curPatch.includes('piatti') || curPatch.includes('tam_tam') || curPatch.includes('anvil') || curPatch.includes('triangle')) {
        return 'Percussion';
      }
      if (curPatch.includes('guitar') || curPatch.includes('banjo') || curPatch.includes('mandolin')) {
        return 'Guitar';
      }
      if (curPatch.includes('synth')) {
        return 'Synth';
      }
    }
    if (selectedVstCategory && selectedVstCategory !== 'Auto') {
      return selectedVstCategory;
    }
    const prog = tracks[editingTrackIndex]?.program ?? 0;
    const tName = (tracks[editingTrackIndex]?.name || '').toLowerCase();
    if (tName.includes('sax')) return 'Saxophones';
    if (tName.includes('recorder')) return 'Recorders';
    if (tName.includes('choir') || tName.includes('voice') || tName.includes('vocal') || (prog >= 52 && prog <= 54)) return 'Choir';
    if (prog >= 40 && prog <= 51) return 'Strings';
    if (prog >= 56 && prog <= 63) return 'Brass';
    if (prog >= 64 && prog <= 79) return 'Woodwind';
    if ((prog >= 112 && prog <= 119) || prog === 127 || prog === 47 || prog === 46 || (prog >= 8 && prog <= 15)) return 'Percussion';
    if (prog >= 24 && prog <= 31) return 'Guitar';
    return 'Strings';
  };

  const getAvailableArticulations = () => {
    if (editingTrackIndex === null) return ARTICULATIONS_BY_CATEGORY['Strings'];
    const curPatch = (tracksConfig[String(editingTrackIndex)]?.instrument_patch || 'auto').toLowerCase();

    // Specific preset overrides:
    if (curPatch.includes('timpani')) {
      return [
        { id: 'auto', label: 'Auto Detect' },
        { id: 'hits', label: 'Hits (Standard Strike)' },
        { id: 'rolls', label: 'Rolls (Sustained Roll)' },
        { id: 'hits_soft', label: 'Hits Soft (Felt Mallet)' },
        { id: 'rolls_soft', label: 'Rolls Soft (Swelling Roll)' },
        { id: 'hits_hotrods', label: 'Hits Hotrods (Birch Dowels)' },
        { id: 'rolls_hotrods', label: 'Long Rolls Hotrods' },
        { id: 'hits_damped', label: 'Hits Damped (Muffled)' },
        { id: 'hits_super_damped', label: 'Hits Super Damped (Choked)' },
        { id: 'hotrods_hits_damped', label: 'Hotrods Hits Damped' },
        { id: 'hits_damped_soft', label: 'Hits Damped Soft' },
      ];
    }

    if (curPatch.includes('harp')) {
      return [
        { id: 'auto', label: 'Auto Detect' },
        { id: 'sustained', label: 'Sustained (Full Ring)' },
        { id: 'damped', label: 'Damped (Muted Pluck)' },
        { id: 'damped_medium', label: 'Damped Medium' },
        { id: 'bisbigliando', label: 'Bisbigliando (Whispering Tremolo)' },
        { id: 'gliss_fx', label: 'Glissando FX (Sweeping Gliss)' },
      ];
    }

    if (curPatch.includes('marimba') || curPatch.includes('xylophone') || curPatch.includes('glockenspiel') || curPatch.includes('celeste') || curPatch.includes('crotales') || curPatch.includes('tubular') || curPatch.includes('bells') || curPatch.includes('vibraphone')) {
      return [
        { id: 'auto', label: 'Auto Detect' },
        { id: 'hits', label: 'Hits (Standard Strike)' },
        { id: 'rolls', label: 'Rolls (Sustained Roll)' },
        { id: 'damped', label: 'Damped (Muted Tone)' },
        { id: 'bowed', label: 'Bowed (Ethereal Glassy)' },
      ];
    }

    if (curPatch.includes('piccolo')) {
      return [
        { id: 'auto', label: 'Auto Detect' },
        { id: 'legato', label: 'Legato (Smooth)' },
        { id: 'long', label: 'Long (Sustained)' },
        { id: 'staccatissimo', label: 'Staccatissimo (Short)' },
        { id: 'tenuto', label: 'Tenuto (Held Length)' },
        { id: 'marcato', label: 'Marcato (Accented)' },
        { id: 'trill_maj2', label: 'Trill Major 2nd' },
        { id: 'trill_min2', label: 'Trill Minor 2nd' },
        { id: 'long_flutter', label: 'Long Flutter (Flutter Tongue)' },
        { id: 'multi_tongue', label: 'Multi-Tongue (Rapid)' },
        { id: 'rips', label: 'Rips (Upward Gliss)' },
        { id: 'falls', label: 'Falls (Downward Drop)' },
      ];
    }

    if (curPatch.includes('alto_sax') || curPatch.includes('alto sax')) {
      return [
        { id: 'auto', label: 'Auto Detect' },
        { id: 'long', label: 'Long (Sustained Drama)' },
        { id: 'soft', label: 'Soft (Gentle Breath)' },
        { id: 'growl', label: 'Growl (Throaty Rasp)' },
        { id: 'chatter', label: 'Chatter (Rhythmic Movement)' },
        { id: 'layered_chatter', label: 'Layered Chatter (Cluster)' },
        { id: 'perf', label: 'Performance (Dynamic Legato)' },
        { id: 'soft_perf', label: 'Soft Performance' },
        { id: 'rounded_short', label: 'Rounded Short (Mellow Staccato)' },
      ];
    }

    if (curPatch.includes('bass_sax') || curPatch.includes('bass sax') || curPatch.includes('saxophone_ensemble') || curPatch.includes('sax')) {
      return [
        { id: 'auto', label: 'Auto Detect' },
        { id: 'long', label: 'Long (Sustained Drama)' },
        { id: 'soft', label: 'Soft (Gentle Breath)' },
        { id: 'chatter', label: 'Chatter (Rhythmic Movement)' },
        { id: 'layered_chatter', label: 'Layered Chatter (Cluster)' },
        { id: 'perf', label: 'Performance (Dynamic Legato)' },
        { id: 'rounded_short', label: 'Rounded Short (Mellow Staccato)' },
      ];
    }

    if (curPatch.includes('recorder')) {
      return [
        { id: 'auto', label: 'Auto Detect' },
        { id: 'long', label: 'Long (Straight Tone)' },
        { id: 'soft', label: 'Soft (Feathered Air)' },
        { id: 'bend_vib', label: 'Bend Vibrato (Expressive)' },
        { id: 'chiff', label: 'Chiff (Short Breathy Attack)' },
        { id: 'flutter', label: 'Flutter Tongue' },
        { id: 'layered_flutter', label: 'Layered Flutter' },
        { id: 'perf', label: 'Performance (Dynamic Legato)' },
        { id: 'rounded_short', label: 'Rounded Short (Clean Short)' },
      ];
    }

    if (curPatch.includes('tuba')) {
      return [
        { id: 'auto', label: 'Auto Detect' },
        { id: 'legato', label: 'Legato (Extended Smooth)' },
        { id: 'long', label: 'Long (Sustained)' },
        { id: 'staccatissimo', label: 'Staccatissimo (Ultra Short)' },
        { id: 'marcato', label: 'Marcato (Accented)' },
        { id: 'long_cuivre', label: 'Long Cuivre (Brassy Power)' },
        { id: 'long_sfz', label: 'Long SFZ (Sforzando)' },
        { id: 'long_flutter', label: 'Long Flutter (Flutter Tongue)' },
        { id: 'multi_tongue', label: 'Multi-Tongue (Rapid)' },
      ];
    }

    const cat = getActiveTrackCategory();
    return ARTICULATIONS_BY_CATEGORY[cat] || ARTICULATIONS_BY_CATEGORY['Strings'];
  };

  const clearSelection = () => setSelectedJobs(new Set());

  const handleAddToPlaylist = async (plName: string) => {
    if (selectedJobs.size === 0) return;
    const selectedIds = Array.from(selectedJobs);
    const toAddFilenames: string[] = [];
    
    for (const id of selectedIds) {
      const job = jobs.find(j => j.job_id === id);
      if (!job) continue;
      
      const key = (job.status === 'completed' && job.validated) ? `hybrid:${job.job_id}` : (job.filename || `hybrid:${job.job_id}`);
      toAddFilenames.push(key);
      
      const existingPl = new Set<string>(job.playlists || []);
      existingPl.add(plName);
      await midiOrchestratorApi.updateMetadata(job.job_id, { playlists: Array.from(existingPl) }).catch(() => {});
    }

    try {
      await playlistApi.addBulk(plName, toAddFilenames);
    } catch (e) {
      console.error('Failed to add jobs to playlist', e);
    }

    setPlaylistModal({ visible: false, newPlaylistName: '' });
    clearSelection();
    await fetchJobs();
  };

  const handleCreateAndAddPlaylist = async () => {
    const name = playlistModal.newPlaylistName.trim();
    if (!name) return;
    try {
      await playlistApi.createPlaylist(name);
      await handleAddToPlaylist(name);
    } catch (e) {
      console.error('Failed to create and add playlist', e);
      Alert.alert('Error', 'Failed to create playlist');
    }
  };

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

  const getSoundfontLabel = (sf?: string, lastBuilt?: string): { text: string; color: string; bg: string } => {
    const target = lastBuilt || sf || '';
    if (!target) return { text: 'SF2', color: '#95a5a6', bg: 'rgba(149, 165, 166, 0.15)' };
    
    if (target.toLowerCase().includes('fallback')) {
      return { text: 'FB: SF2', color: '#e67e22', bg: 'rgba(230, 126, 34, 0.18)' };
    }
    if (target.toLowerCase().includes('bbc') || target.toLowerCase().includes('vst')) {
      return { text: 'BBC VST', color: '#a29bfe', bg: 'rgba(162, 155, 254, 0.18)' };
    }
    if (target.toLowerCase().includes('fluid')) {
      return { text: 'FluidR3', color: '#3498db', bg: 'rgba(52, 152, 219, 0.18)' };
    }
    const cleanName = target.replace(/\.sf2$/i, '').replace(/\.vst3$/i, '');
    return { text: cleanName.length > 10 ? cleanName.substring(0, 10) : cleanName, color: '#2ecc71', bg: 'rgba(46, 204, 113, 0.18)' };
  };

  const hasCustomTrackSettings = (tracksConfig?: Record<string, any>): boolean => {
    if (!tracksConfig) return false;
    return Object.values(tracksConfig).some(cfg => {
      if (!cfg) return false;
      if (cfg.preset && typeof cfg.preset === 'string' && cfg.preset.trim() !== '') return true;
      if (cfg.gain !== undefined && Math.abs(cfg.gain - 1.0) > 0.01) return true;
      if (cfg.pan !== undefined && Math.abs(cfg.pan) > 0.01) return true;
      if (cfg.pitch !== undefined && cfg.pitch !== 0) return true;
      if (cfg.patch !== undefined && cfg.patch !== null && cfg.patch !== '') return true;
      return false;
    });
  };

  // Selected job details
  const currentJob = useMemo(() => {
    return jobs.find(j => j.job_id === selectedJobId) || null;
  }, [jobs, selectedJobId]);

  const editingTrackInfo = useMemo(() => {
    if (editingTrackIndex === null || !currentJob || !currentJob.tracks) return null;
    return currentJob.tracks.find((t: any) => t.index === editingTrackIndex) || null;
  }, [editingTrackIndex, currentJob]);

  // Pre-fill Custom Track Name when opening Track Settings Modal if not already customized
  useEffect(() => {
    if (editingTrackIndex !== null && editingTrackInfo) {
      const existingName = tracksConfig[String(editingTrackIndex)]?.name;
      if (existingName === undefined || existingName === null || existingName.trim() === '') {
        const fullDefaultName = editingTrackInfo.display_name || editingTrackInfo.name || editingTrackInfo.instrument_name || `Track ${editingTrackIndex}`;
        setTracksConfig(prev => ({
          ...prev,
          [String(editingTrackIndex)]: { ...prev[String(editingTrackIndex)], name: fullDefaultName }
        }));
      }
    }
  }, [editingTrackIndex, editingTrackInfo]);

  const filteredJobs = useMemo(() => {
    let result = [...jobs];
    
    // 1. Search Filter (treat dashes and underscores as spaces)
    if (search.trim()) {
      const query = search.toLowerCase().replace(/[-_]/g, ' ');
      result = result.filter(j => {
        const title = (j.filename || '').toLowerCase().replace(/[-_]/g, ' ');
        const artist = (j.artist || '').toLowerCase().replace(/[-_]/g, ' ');
        return title.includes(query) || artist.includes(query);
      });
    }

    // 2. Sorting
    result.sort((a, b) => {
      if (sortBy === 'name') {
        const aTitle = getCleanTitle(a.filename || '');
        const bTitle = getCleanTitle(b.filename || '');
        return aTitle.localeCompare(bTitle);
      } else if (sortBy === 'artist') {
        return (a.artist || '').localeCompare(b.artist || '');
      } else if (sortBy === 'rating') {
        return (b.rating || 0) - (a.rating || 0);
      } else if (sortBy === 'created') {
        return (b.timestamp || 0) - (a.timestamp || 0);
      } else if (sortBy === 'length') {
        const aLen = a.tracks && a.tracks.length > 0 ? Math.max(...a.tracks.map((t: any) => t.duration || 0)) : 0;
        const bLen = b.tracks && b.tracks.length > 0 ? Math.max(...b.tracks.map((t: any) => t.duration || 0)) : 0;
        return bLen - aLen;
      }
      return 0;
    });

    return result;
  }, [jobs, search, sortBy]);

  const hasChanges = useMemo(() => {
    if (!currentJob) return false;
    const savedPiano = new Set(currentJob.piano_tracks || []);
    const savedSpeaker = new Set(currentJob.speaker_tracks || []);
    const savedMale = new Set(currentJob.vocal_male_tracks || []);
    const savedFemale = new Set(currentJob.vocal_female_tracks || []);
    
    if (pianoTracks.size !== savedPiano.size) return true;
    if (speakerTracks.size !== savedSpeaker.size) return true;
    if (vocalMaleTracks.size !== savedMale.size) return true;
    if (vocalFemaleTracks.size !== savedFemale.size) return true;
    
    for (const id of pianoTracks) {
      if (!savedPiano.has(id)) return true;
    }
    for (const id of speakerTracks) {
      if (!savedSpeaker.has(id)) return true;
    }
    for (const id of vocalMaleTracks) {
      if (!savedMale.has(id)) return true;
    }
    for (const id of vocalFemaleTracks) {
      if (!savedFemale.has(id)) return true;
    }
    
    if (pedalPreset !== currentJob.pedal_preset) return true;
    if (rhythmFactor !== currentJob.rhythm_factor) return true;
    if (melodyFactor !== currentJob.melody_factor) return true;
    
    return false;
  }, [currentJob, pianoTracks, speakerTracks, vocalMaleTracks, vocalFemaleTracks, pedalPreset, rhythmFactor, melodyFactor]);

  useEffect(() => {
    if (!currentJob) return;
    if (currentJob.status !== 'completed' || hasChanges) {
      setPlaybackMode('preview');
    } else {
      setPlaybackMode('performance');
    }
  }, [currentJob?.status, hasChanges]);

  const openUnifiedWorkspace = async (jobId: string) => {
    const job = jobs.find(j => j.job_id === jobId);
    if (!job) return;

    setSelectedJobId(jobId);
    setPianoTracks(new Set(job.piano_tracks || []));
    setSpeakerTracks(new Set(job.speaker_tracks || []));
    setVocalMaleTracks(new Set(job.vocal_male_tracks || []));
    setVocalFemaleTracks(new Set(job.vocal_female_tracks || []));
    setPedalPreset(job.pedal_preset || 'light');
    setRhythmFactor(job.rhythm_factor ?? 1.0);
    setMelodyFactor(job.melody_factor ?? 1.0);
    const impVoc = job.imported_vocals || null;
    setImportedVocalsJobId(impVoc?.mp3_job_id || null);
    setImportedVocalsOriginalName(impVoc?.original_name || null);
    setImportedVocalsDelayMs(impVoc?.delay_ms || 0);
    setImportedVocalsEnabled(impVoc?.enabled ?? true);
    setImportedVocalsVolumeFactor(impVoc?.volume_factor ?? 1.0);
    setImportedVocalsBreaklines(impVoc?.breaklines || []);
    setMp3VocalsPosition(impVoc?.position ?? null);
    setVocalsWaveformEnvelope(null);
    setLoopStartMs(null);
    setLoopEndMs(null);
    setLoopEnabled(false);
    setTracksConfig(job.tracks_config || {});

    // Load per-job soundfont & audio parameters, falling back to legacy defaults for older files
    try {
      const globalAudio = await midiOrchestratorApi.getAudioSettings().catch(() => ({}));
      const jobSf = job.soundfont || (job.status === 'completed' ? 'SGM-V2.01.sf2' : (globalAudio.active_soundfont || 'SGM-V2.01.sf2'));
      setActiveSoundfont(jobSf);
      setReverbEnabled(job.reverb_enabled ?? globalAudio.reverb_enabled ?? true);
      setReverbRoomSize(job.reverb_room_size ?? globalAudio.reverb_room_size ?? 0.55);
      if (job.reverb_preset) {
        setSelectedReverbPreset(job.reverb_preset);
      }
      setPeakCeilingDb(job.peak_ceiling_db ?? globalAudio.peak_ceiling_db ?? -6.0);
    } catch (err) {
      console.error('Failed to load per-job audio settings:', err);
    }

    setLoading(true);
    try {
      if (impVoc?.mp3_job_id) {
        try {
          const waveData = await midiOrchestratorApi.getVocalsWaveform(impVoc.mp3_job_id);
          setVocalsWaveformEnvelope(waveData.envelope || null);
        } catch (waveErr) {
          console.error("Failed to fetch vocals waveform:", waveErr);
        }
      }
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

      // 3. Clear audio refs - audio loading will occur on-demand when user presses Play or Preview
      setStage('visualizer');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Workspace Error', 'Failed to load visualizer workspace.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenMp3ImportModal = async () => {
    try {
      setLoading(true);
      const jobsList = await mp3Api.listJobs();
      const completed = jobsList.filter((j: any) => j.status === 'completed' && j.vocals);
      setMp3Jobs(completed);
      setShowMp3ImportModal(true);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', 'Failed to fetch MP3 orchestrator library.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMp3Vocals = async (mp3JobId: string) => {
    try {
      setShowMp3ImportModal(false);
      const job = mp3Jobs.find(j => j.job_id === mp3JobId);
      const origName = job?.original_name || job?.filename || 'Untitled MP3 Job';
      
      const applySelection = async (keep: boolean) => {
        try {
          setLoading(true);
          setImportedVocalsJobId(mp3JobId);
          setImportedVocalsOriginalName(origName);
          setImportedVocalsEnabled(true);
          
          if (!keep) {
            setImportedVocalsDelayMs(0);
            setImportedVocalsVolumeFactor(1.0);
            setImportedVocalsBreaklines([]);
          }
          
          const waveData = await midiOrchestratorApi.getVocalsWaveform(mp3JobId);
          setVocalsWaveformEnvelope(waveData.envelope || null);
        } catch (e: any) {
          console.error(e);
          Alert.alert('Waveform Error', 'Could not load vocal waveform details.');
        } finally {
          setLoading(false);
        }
      };

      if (importedVocalsBreaklines && importedVocalsBreaklines.length > 0) {
        if (Platform.OS === 'web') {
          const retain = window.confirm(
            'Would you like to RETAIN your existing breakline sync adjustments for the new track?\n\n' +
            'Click OK to Retain adjustments.\n' +
            'Click Cancel to choose Clear or Cancel.'
          );
          if (retain) {
            await applySelection(true);
          } else {
            const clear = window.confirm(
              'Would you like to CLEAR all adjustments for the new track?\n\n' +
              'Click OK to Clear adjustments.\n' +
              'Click Cancel to Abort track swapping.'
            );
            if (clear) {
              await applySelection(false);
            }
          }
        } else {
          Alert.alert(
            'Existing Adjustments',
            'Would you like to retain your existing breakline sync adjustments for the new track?',
            [
              {
                text: 'Retain Adjustments',
                onPress: () => applySelection(true),
              },
              {
                text: 'Clear Adjustments',
                onPress: () => applySelection(false),
                style: 'destructive',
              },
              {
                text: 'Cancel',
                onPress: () => {},
                style: 'cancel',
              }
            ]
          );
        }
      } else {
        await applySelection(false);
      }
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', 'An unexpected error occurred while selecting the track.');
    }
  };

  const handleVocalsLongPress = (locationX: number) => {
    const tMs = Math.round((locationX / PIXELS_PER_SECOND) * 1000);
    setTooltipTimeMs(tMs);
    setShowTooltip(true);
  };

  const handleAddBreakline = () => {
    const playPos = Math.round(playbackPos);
    if (importedVocalsBreaklines.some(b => b.time_ms === playPos)) {
      Alert.alert('Duplicate Marker', 'A breakline already exists at this timestamp.');
      return;
    }
    
    let initialOffset = importedVocalsDelayMs;
    const sorted = [...importedVocalsBreaklines].sort((a,b) => a.time_ms - b.time_ms);
    for (const b of sorted) {
      if (b.time_ms < playPos) {
        initialOffset = b.offset_ms;
      } else {
        break;
      }
    }

    const updated = [...importedVocalsBreaklines, { time_ms: playPos, offset_ms: initialOffset }]
      .sort((a, b) => a.time_ms - b.time_ms);
    setImportedVocalsBreaklines(updated);
  };

  const handleUpdateBreaklineOffset = (index: number, delta: number) => {
    const updated = importedVocalsBreaklines.map((b, i) => {
      if (i === index) {
        return { ...b, offset_ms: b.offset_ms + delta };
      }
      return b;
    });
    setImportedVocalsBreaklines(updated);
  };

  const handleDeleteBreakline = (index: number) => {
    const updated = importedVocalsBreaklines.filter((_, i) => i !== index);
    setImportedVocalsBreaklines(updated);
  };

  const handleDeleteLoopStart = () => {
    setLoopStartMs(null);
    setLoopEnabled(false);
  };

  const handleDeleteLoopEnd = () => {
    setLoopEndMs(null);
    setLoopEnabled(false);
  };

  const handleToggleTrackRole = (trackIndex: number, role: 'piano' | 'speakers' | 'male_vocal' | 'female_vocal' | 'mute') => {
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

    setVocalMaleTracks(prev => {
      const next = new Set(prev);
      if (role === 'male_vocal') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });

    setVocalFemaleTracks(prev => {
      const next = new Set(prev);
      if (role === 'female_vocal') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
  };

  // Load jobs list
  const fetchJobs = async () => {
    try {
      const [data, pData] = await Promise.all([
        midiOrchestratorApi.listJobs(),
        playlistApi.listPlaylists().catch(() => ({}))
      ]);
      if (pData) {
        useStore.getState().setPlaylists(pData);
      }
      const storePlaylists = pData || useStore.getState().playlists || {};
      const enrichedJobs = data.map((j: any) => {
        const plSet = new Set<string>();
        const hybridKey = `hybrid:${j.job_id}`;
        Object.entries(storePlaylists).forEach(([plName, plValue]: [string, any]) => {
          const tracks = Array.isArray(plValue) ? plValue : plValue?.tracks || [];
          if (tracks.includes(hybridKey) || (j.filename && tracks.includes(j.filename))) {
            plSet.add(plName);
          }
        });
        return { ...j, playlists: Array.from(plSet) };
      });
      const newJson = JSON.stringify(enrichedJobs);
      if (newJson !== jobsJsonRef.current) {
        jobsJsonRef.current = newJson;
        setJobs(enrichedJobs);
      }
    } catch (e) {
      console.error('Failed to load midi jobs', e);
    }
  };

  const jobsJsonRef = useRef<string>('');
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

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

  const hasProcessingJobs = useMemo(() => {
    return jobs.some(j => j.status === 'processing' || j.status === 'synthesizing' || j.status?.includes('synthesizing') || j.status?.includes('mixing'));
  }, [jobs]);

  // Poll job status cleanly if any is processing or synthesizing
  useEffect(() => {
    let timer: any = null;
    if (hasProcessingJobs) {
      timer = setInterval(() => {
        const active = jobsRef.current.some(j => j.status === 'processing' || j.status === 'synthesizing' || j.status?.includes('synthesizing') || j.status?.includes('mixing'));
        if (active) {
          fetchJobs();
        }
      }, 2000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [hasProcessingJobs]);

  // Handle MIDI Upload
  const handleUpload = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['audio/midi', 'audio/x-midi', 'audio/mid', '*/*'],
        copyToCacheDirectory: true,
        multiple: true
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;

      setLoading(true);
      
      const uploadedJobs = [];
      let lastJobId = null;

      for (const asset of res.assets) {
        if (!asset.name.toLowerCase().endsWith('.mid') && !asset.name.toLowerCase().endsWith('.midi')) {
          continue;
        }

        try {
          // Read file content as Base64 (using browser FileReader on Web, FileSystem on Mobile)
          let base64Data = '';
          if (Platform.OS === 'web') {
            const response = await fetch(asset.uri);
            const blob = await response.blob();
            base64Data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const resultStr = reader.result as string;
                const base64 = resultStr.split(',')[1];
                resolve(base64);
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } else {
            base64Data = await FileSystem.readAsStringAsync(asset.uri, {
              encoding: 'base64',
            });
          }

          const data = await midiOrchestratorApi.uploadBase64(asset.name, base64Data);
          uploadedJobs.push(data);
          lastJobId = data.job_id;
        } catch (err) {
          console.error(`Failed to upload ${asset.name}:`, err);
        }
      }

      await fetchJobs();

      if (uploadedJobs.length === 0) {
        Alert.alert('Upload Failed', 'No valid MIDI files were successfully uploaded.');
      } else {
        if (uploadedJobs.length === 1 && lastJobId) {
          Alert.alert('Upload Success', 'MIDI track extracted. Opening configuration workspace...');
          await openUnifiedWorkspace(lastJobId);
        } else {
          Alert.alert('Upload Success', `Successfully uploaded ${uploadedJobs.length} MIDI files.`);
        }
      }
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
    setMp3VocalsPosition(null);
    openUnifiedWorkspace(job.job_id);
  };

  // Delete Job
  const handleDeleteJob = async (jobId: string) => {
    const doDelete = async () => {
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
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to delete this MIDI Orchestration job?')) {
        doDelete();
      }
      return;
    }

    Alert.alert(
      'Delete Job',
      'Are you sure you want to delete this MIDI Orchestration job?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete }
      ]
    );
  };

  const handleBulkDelete = () => {
    if (selectedJobs.size === 0) return;
    const doDelete = async () => {
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
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${selectedJobs.size} MIDI Orchestration jobs?`)) {
        doDelete();
      }
      return;
    }

    Alert.alert(
      'Bulk Delete',
      `Delete ${selectedJobs.size} MIDI Orchestration jobs?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete }
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
        recleanMelody,
        contextJob.vocal_male_tracks || [],
        contextJob.vocal_female_tracks || [],
        contextJob.imported_vocals
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
      const isMetaDnu = meta.dnu !== undefined ? meta.dnu : job.dnu;
      setDetailsDnu(isMetaDnu === true || isMetaDnu === 'true' || isMetaDnu === 1);
      const isMetaValidated = meta.validated !== undefined ? meta.validated : job.validated;
      setDetailsValidated(isMetaValidated === true || isMetaValidated === 'true' || isMetaValidated === 1);
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
      let updatedFilename = contextJob.filename;
      if (newTitle && newTitle !== oldTitle) {
        const originalExt = (contextJob.filename || '').split('.').pop() || 'mid';
        updatedFilename = newTitle.endsWith('.' + originalExt) ? newTitle : `${newTitle}.${originalExt}`;
        await midiOrchestratorApi.rename(contextJob.job_id, updatedFilename);
      }

      await midiOrchestratorApi.updateMetadata(contextJob.job_id, {
        artist: detailsArtist.trim(),
        comments: detailsComments.trim(),
        rating: detailsRating,
        genre: detailsGenre.trim(),
        mood: detailsMood.trim(),
        source: detailsSource.trim(),
        dnu: detailsDnu,
        validated: detailsValidated
      });

      // Update local state immediately for snappy UI reactivity
      setJobs(prevJobs => prevJobs.map(j => {
        if (j.job_id === contextJob.job_id) {
          return {
            ...j,
            filename: updatedFilename,
            artist: detailsArtist.trim(),
            comments: detailsComments.trim(),
            rating: detailsRating,
            genre: detailsGenre.trim(),
            mood: detailsMood.trim(),
            source: detailsSource.trim(),
            dnu: detailsDnu,
            validated: detailsValidated
          };
        }
        return j;
      }));

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
  const handleTrackRoleToggle = (trackIndex: number, role: 'piano' | 'speakers' | 'male_vocal' | 'female_vocal' | 'mute') => {
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
    setVocalMaleTracks(prev => {
      const next = new Set(prev);
      if (role === 'male_vocal') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
    setVocalFemaleTracks(prev => {
      const next = new Set(prev);
      if (role === 'female_vocal') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
  };

  const selectAllTracksForRole = (role: 'speakers' | 'piano' | 'off') => {
    const validTrackIndices = getLanesData
      .filter((l: any) => l.index >= 0)
      .map((l: any) => l.index);

    if (role === 'speakers') {
      setSpeakerTracks(new Set(validTrackIndices));
      setPianoTracks(new Set());
      setVocalMaleTracks(new Set());
      setVocalFemaleTracks(new Set());
    } else if (role === 'piano') {
      setPianoTracks(new Set(validTrackIndices));
      setSpeakerTracks(new Set());
      setVocalMaleTracks(new Set());
      setVocalFemaleTracks(new Set());
    } else {
      setPianoTracks(new Set());
      setSpeakerTracks(new Set());
      setVocalMaleTracks(new Set());
      setVocalFemaleTracks(new Set());
    }
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
      if (previewSoundRef.current) {
        try {
          await previewSoundRef.current.pauseAsync();
        } catch (e) {}
        setIsPreviewPlaying(false);
      } else {
        await stopPreview();
      }
      return;
    }

    // Fast Resume: If audio is already loaded and paused, simply resume playing!
    if (previewSoundRef.current) {
      try {
        await setAudioMode('playback');
        await previewSoundRef.current.playAsync();
        setIsPreviewPlaying(true);
        return;
      } catch (resumeErr) {
        console.log("Resume existing audio failed, reloading...", resumeErr);
      }
    }

    setIsPreviewLoading(true);
    try {
      await setAudioMode('playback');
      if (previewSoundRef.current) {
        try { await previewSoundRef.current.unloadAsync(); } catch (e) {}
        previewSoundRef.current = null;
      }

      const url = midiOrchestratorApi.getPreviewUrl(
        selectedJobId, 
        Array.from(pianoTracks), 
        Array.from(speakerTracks),
        Array.from(vocalMaleTracks),
        Array.from(vocalFemaleTracks),
        { soundfont: activeSoundfont, reverb_enabled: reverbEnabled, reverb_room_size: reverbRoomSize, peak_ceiling_db: peakCeilingDb },
        fullPreviewMode
      );

      const initialStatus = {
        shouldPlay: true,
        progressUpdateIntervalMillis: 100,
        positionMillis: loopStartMs !== null ? loopStartMs : 0
      };

      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        initialStatus,
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
  const executeProcessTask = async () => {
    if (!selectedJobId) return;
    try {
      setLoading(true);
      await midiOrchestratorApi.process(
        selectedJobId,
        Array.from(pianoTracks),
        Array.from(speakerTracks),
        pedalPreset,
        rhythmFactor,
        melodyFactor,
        Array.from(vocalMaleTracks),
        Array.from(vocalFemaleTracks),
        importedVocalsJobId ? {
          mp3_job_id: importedVocalsJobId,
          original_name: importedVocalsOriginalName || undefined,
          delay_ms: importedVocalsDelayMs,
          enabled: importedVocalsEnabled,
          volume_factor: importedVocalsVolumeFactor,
          breaklines: importedVocalsBreaklines,
          position: mp3VocalsPosition ?? undefined
        } : undefined,
        {
          soundfont: activeSoundfont,
          reverb_enabled: reverbEnabled,
          reverb_room_size: reverbRoomSize,
          peak_ceiling_db: peakCeilingDb,
          tracks_config: tracksConfig
        }
      );
      await fetchJobs();
      setStage('list');
      Alert.alert('Processing Started', 'Isolated worker process launched. Monitor progress or view worker logs in the jobs list.');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Processing Failed', e.message || 'Could not start processing.');
    } finally {
      setLoading(false);
    }
  };

  const handleProcess = async () => {
    if (!selectedJobId) return;
    if (pianoTracks.size === 0 && speakerTracks.size === 0 && vocalMaleTracks.size === 0 && vocalFemaleTracks.size === 0) {
      Alert.alert('No Tracks Selected', 'Choose at least one track for Piano, Speakers, or Vocals.');
      return;
    }

    const runningJob = jobs.find(j => (j.status === 'processing' || j.status === 'synthesizing' || j.status?.includes('synthesizing')));
    if (runningJob) {
      setActiveRunningJob(runningJob);
      setShowConflictModal(true);
      return;
    }

    await executeProcessTask();
  };

  // Sound Playback Updates
  const lastPosRef = useRef<number>(0);
  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      // Loop check
      const { enabled: isLoop, start: lStart, end: lEnd } = loopConfigRef.current;
      if (isLoop && lStart !== null && lEnd !== null && status.isPlaying) {
        if (status.positionMillis >= lEnd) {
          if (playbackMode === 'performance') {
            soundRef.current?.setPositionAsync(lStart);
          } else {
            previewSoundRef.current?.setPositionAsync(lStart);
          }
          return;
        }
      }

      if (!isSeekingRef.current) {
        const newPos = status.positionMillis || 0;
        if (Math.abs(newPos - lastPosRef.current) > 200 || status.didJustFinish) {
          lastPosRef.current = newPos;
          setPlaybackPos(newPos);
        }
      }
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
    if (!selectedJobId) return;

    if (!soundRef.current) {
      try {
        const url = midiOrchestratorApi.getBackingAudioUrl(selectedJobId);
        const { sound } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: false, progressUpdateIntervalMillis: 100 },
          onPlaybackStatusUpdate
        );
        soundRef.current = sound;
      } catch (backingErr) {
        console.warn('Could not load performance backing audio:', backingErr);
      }
    }

    if (!soundRef.current) {
      Alert.alert('Playback Error', 'Backing audio is not loaded or ready.');
      return;
    }

    try {
      await setAudioMode('playback');
      setSystemBusy(true);
      setIsPlaying(true);

      if (loopStartMs !== null) {
        await soundRef.current.setPositionAsync(loopStartMs);
        setPlaybackPos(loopStartMs);
      }

      const isSynthesizedPlay = pianoTracks.size > 0;
      const useBackendRoute = backendAudioEnabled && isSynthesizedPlay;

      // Set volume before playing
      await soundRef.current.setStatusAsync({ volume: useBackendRoute ? 0.0 : 1.0 });

      const playPianoMidi = async () => {
        if (isSynthesizedPlay || useBackendRoute) {
          try {
            await midiOrchestratorApi.playMidi(selectedJobId, globalOffset);
          } catch (e: any) {
            console.error('Backend play failed', e);
            const msg = e.response?.data?.detail || e.message || 'Unknown error';
            Alert.alert('Playback Error', `Failed to play backend audio/keys: ${msg}`);
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
    const lanes = currentJob.tracks.filter((t: any) => {
      const trackNotes = notes[String(t.index)] || [];
      return trackNotes.length > 0;
    }).map((track: any) => {
      const trackNotes = notes[String(track.index)] || [];
      const pitches = trackNotes.map(n => n.pitch);
      const minPitch = pitches.length > 0 ? Math.min(...pitches) : 40;
      const maxPitch = pitches.length > 0 ? Math.max(...pitches) : 80;
      const pitchRange = Math.max(12, maxPitch - minPitch); // avoid division by zero, min 1 octave height scale
      
      const cleanName = track.display_name || track.name;
      return {
        ...track,
        name: cleanName,
        display_name: cleanName,
        notes: trackNotes,
        minPitch,
        maxPitch,
        pitchRange
      };
    });

    if (importedVocalsJobId) {
      const vocalsLane = {
        index: -99,
        name: "🎙️ MP3 Vocals",
        program: -1,
        instrument_name: "Audio Stems",
        is_drum: false,
        note_count: 0,
        duration: 0.0,
        notes: [],
        minPitch: 0,
        maxPitch: 0,
        pitchRange: 1
      };

      const targetPos = (mp3VocalsPosition !== null && mp3VocalsPosition >= 0 && mp3VocalsPosition <= lanes.length)
        ? mp3VocalsPosition
        : lanes.length;

      lanes.splice(targetPos, 0, vocalsLane);
    }

    return lanes;
  }, [currentJob, notes, importedVocalsJobId, mp3VocalsPosition]);

  const isDraggingMp3Ref = useRef(isDraggingMp3Vocals);
  isDraggingMp3Ref.current = isDraggingMp3Vocals;
  const getLanesDataRef = useRef<any[]>([]);
  getLanesDataRef.current = getLanesData;

  const startMp3Drag = (clientY: number) => {
    dragStartYRef.current = clientY;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      const currentIdx = getLanesData.findIndex(l => l.index === -99);
      if (currentIdx !== -1) {
        mp3StartPosRef.current = currentIdx;
        setIsDraggingMp3Vocals(true);
      }
    }, 200);
  };

  const moveMp3Drag = (clientY: number) => {
    if (!isDraggingMp3Vocals && longPressTimerRef.current) {
      if (Math.abs(clientY - dragStartYRef.current) > 15) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      return;
    }
    if (isDraggingMp3Vocals) {
      const dy = clientY - dragStartYRef.current;
      const stepDelta = Math.round(dy / LANE_HEIGHT);
      const totalLanes = getLanesData.length;
      const newPos = Math.max(0, Math.min(totalLanes - 1, mp3StartPosRef.current + stepDelta));
      setMp3VocalsPosition(newPos);
    }
  };

  const endMp3Drag = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsDraggingMp3Vocals(false);
  };

  const mp3PanResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return isDraggingMp3Ref.current || Math.abs(gestureState.dy) > 10;
      },
      onMoveShouldSetPanResponderCapture: (_, gestureState) => isDraggingMp3Ref.current,
      onPanResponderGrant: (evt) => {
        dragStartYRef.current = evt.nativeEvent.pageY;
        const currentIdx = getLanesDataRef.current.findIndex(l => l.index === -99);
        if (currentIdx !== -1) {
          mp3StartPosRef.current = currentIdx;
        }
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = setTimeout(() => {
          setIsDraggingMp3Vocals(true);
        }, 200);
      },
      onPanResponderMove: (_, gestureState) => {
        if (!isDraggingMp3Ref.current) {
          if (Math.abs(gestureState.dy) > 15 && longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
          return;
        }
        const stepDelta = Math.round(gestureState.dy / LANE_HEIGHT);
        const totalLanes = getLanesDataRef.current.length;
        const newPos = Math.max(0, Math.min(totalLanes - 1, mp3StartPosRef.current + stepDelta));
        setMp3VocalsPosition(newPos);
      },
      onPanResponderRelease: () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        setIsDraggingMp3Vocals(false);
      },
      onPanResponderTerminate: () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        setIsDraggingMp3Vocals(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!isDraggingMp3Vocals) return;
    const handleWindowMove = (e: MouseEvent | TouchEvent) => {
      const pageY = 'touches' in e && e.touches[0] ? e.touches[0].pageY : (e as MouseEvent).pageY;
      if (pageY !== undefined) {
        moveMp3Drag(pageY);
      }
    };
    const handleWindowEnd = () => {
      endMp3Drag();
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('mousemove', handleWindowMove);
      window.addEventListener('mouseup', handleWindowEnd);
      window.addEventListener('touchmove', handleWindowMove);
      window.addEventListener('touchend', handleWindowEnd);
      return () => {
        window.removeEventListener('mousemove', handleWindowMove);
        window.removeEventListener('mouseup', handleWindowEnd);
        window.removeEventListener('touchmove', handleWindowMove);
        window.removeEventListener('touchend', handleWindowEnd);
      };
    }
  }, [isDraggingMp3Vocals]);

  const panTimelineBy = (seconds: number) => {
    const durationSec = playbackDuration / 1000 || currentJob?.tracks[0]?.duration || 180;
    const timelineWidth = durationSec * PIXELS_PER_SECOND;
    const deltaX = seconds * PIXELS_PER_SECOND;
    const maxScrollX = Math.max(0, timelineWidth - SCREEN_WIDTH + 170);
    const newX = Math.max(0, Math.min(maxScrollX, visibleScrollX + deltaX));
    scrollRef.current?.scrollTo({ x: newX, animated: true });
    setVisibleScrollX(newX);
  };

  // Timeline render item notes
  const renderVisualizerTimeline = () => {
    const durationSec = playbackDuration / 1000 || currentJob?.tracks[0]?.duration || 180;
    const timelineWidth = durationSec * PIXELS_PER_SECOND;
    
    // Calculate totalHeight and individual lane offsets dynamically
    let totalHeight = 0;
    const laneOffsets: number[] = [];
    const laneHeights: number[] = [];
    getLanesData.forEach((lane) => {
      laneOffsets.push(totalHeight);
      const h = lane.index === -99 ? 120 : LANE_HEIGHT;
      laneHeights.push(h);
      totalHeight += h;
    });

    return (
      <View style={{ flex: 1, position: 'relative' }}>
        <ScrollView 
          style={[styles.verticalLanesScrollView, { backgroundColor: themeColors.background }]}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 60 }}
          removeClippedSubviews={true}
        >
          <View style={styles.visualizerContainer}>
            {/* Left Track Names Sidebar */}
            <View style={[styles.sidebar, { borderRightColor: themeColors.border, backgroundColor: themeColors.surface, height: totalHeight }]}>
            {getLanesData.map((lane: any) => {
              const isPiano = pianoTracks.has(lane.index);
              const isSpeaker = speakerTracks.has(lane.index);
              const isMale = vocalMaleTracks.has(lane.index);
              const isFemale = vocalFemaleTracks.has(lane.index);
              const isMuted = !isPiano && !isSpeaker && !isMale && !isFemale;
              
              if (lane.index === -99) {
                return (
                  <View 
                    key="-99" 
                    style={[
                      styles.sidebarLane, 
                      { 
                        height: 120, 
                        borderBottomColor: themeColors.border, 
                        paddingHorizontal: 8, 
                        justifyContent: 'center',
                        backgroundColor: isDraggingMp3Vocals ? 'rgba(232, 67, 147, 0.25)' : themeColors.surface,
                        borderColor: isDraggingMp3Vocals ? '#e84393' : 'transparent',
                        borderWidth: isDraggingMp3Vocals ? 2 : 0,
                        elevation: isDraggingMp3Vocals ? 8 : 0,
                        zIndex: isDraggingMp3Vocals ? 999 : 1,
                      }
                    ]}
                  >
                    {/* Top Half: Drag Handle & Track Info (Only Area with Drag Listener) */}
                    <View 
                      {...mp3PanResponder.panHandlers}
                      onTouchStart={(e: any) => startMp3Drag(e.touches?.[0]?.pageY || e.nativeEvent?.pageY || 0)}
                      onTouchEnd={endMp3Drag}
                      {...(Platform.OS === 'web' ? {
                        onMouseDown: (e: any) => startMp3Drag(e.pageY || e.clientY || 0),
                        onMouseUp: endMp3Drag
                      } as any : {})}
                      style={{ 
                        flexDirection: 'row', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        marginBottom: 8,
                        paddingVertical: 6,
                        paddingHorizontal: 4,
                        borderRadius: 6,
                        backgroundColor: 'rgba(232, 67, 147, 0.08)',
                        ...(Platform.OS === 'web' ? { cursor: isDraggingMp3Vocals ? 'grabbing' : 'grab' } as any : {})
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 6 }}>
                        <Ionicons 
                          name="reorder-two" 
                          size={20} 
                          color={isDraggingMp3Vocals ? "#e84393" : themeColors.textMuted} 
                          style={{ marginRight: 4 }} 
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.sidebarLaneTitle, { color: themeColors.text, fontWeight: 'bold' }]} numberOfLines={1}>
                            🎙️ MP3 Vocals
                          </Text>
                          {isDraggingMp3Vocals ? (
                            <Text style={{ fontSize: 9, color: '#e84393', fontWeight: 'bold' }}>Dragging track...</Text>
                          ) : (
                            <Text style={{ fontSize: 8, color: themeColors.textMuted }}>Hold header to drag</Text>
                          )}
                        </View>
                      </View>
                      <TouchableOpacity 
                        style={[
                          styles.allocToggleBtn, 
                          importedVocalsEnabled ? { backgroundColor: '#e84393' } : { backgroundColor: themeColors.border }
                        ]}
                        onPress={() => setImportedVocalsEnabled(!importedVocalsEnabled)}
                      >
                        <Ionicons name={importedVocalsEnabled ? "volume-high" : "volume-mute"} size={12} color="#fff" />
                      </TouchableOpacity>
                    </View>
                    
                    {/* Bottom Half: Delay controls (Isolated from Drag Handlers) */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 }}>
                      <HoldableButton 
                        style={{ paddingVertical: 8, paddingHorizontal: 16, minWidth: 54, backgroundColor: themeColors.border, borderRadius: 6, alignItems: 'center' }}
                        onPressAction={() => setImportedVocalsDelayMs(prev => prev - 50)}
                      >
                        <Text style={{ fontSize: 11, color: themeColors.text, fontWeight: 'bold' }}>-50</Text>
                      </HoldableButton>
                      
                      <Text style={{ fontSize: 11, color: themeColors.text, fontWeight: 'bold' }}>
                        {importedVocalsDelayMs >= 0 ? `+${importedVocalsDelayMs}` : importedVocalsDelayMs}ms
                      </Text>
                      
                      <HoldableButton 
                        style={{ paddingVertical: 8, paddingHorizontal: 16, minWidth: 54, backgroundColor: themeColors.border, borderRadius: 6, alignItems: 'center' }}
                        onPressAction={() => setImportedVocalsDelayMs(prev => prev + 50)}
                      >
                        <Text style={{ fontSize: 11, color: themeColors.text, fontWeight: 'bold' }}>+50</Text>
                      </HoldableButton>
                    </View>
                  </View>
                );
              }

              const fullLaneTitle = tracksConfig[String(lane.index)]?.name || lane.display_name || lane.name || lane.instrument_name || `Track ${lane.index}`;
              return (
                <View key={lane.index} style={[styles.sidebarLane, { height: LANE_HEIGHT, borderBottomColor: themeColors.border }]}>
                  <TouchableOpacity
                    onLongPress={() => setEditingTrackIndex(lane.index)}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}
                  >
                    <Text 
                      style={[styles.sidebarLaneTitle, { color: themeColors.text, flex: 1 }]} 
                      numberOfLines={1}
                      accessibilityLabel={fullLaneTitle}
                      {...(Platform.OS === 'web' ? { title: fullLaneTitle } as any : {})}
                    >
                      {fullLaneTitle}
                    </Text>
                    <TouchableOpacity onPress={() => setEditingTrackIndex(lane.index)} style={{ padding: 2 }}>
                      <Ionicons 
                        name={tracksConfig[String(lane.index)] ? "options" : "options-outline"} 
                        size={13} 
                        color={tracksConfig[String(lane.index)] ? themeColors.accent : themeColors.textMuted} 
                      />
                    </TouchableOpacity>
                  </TouchableOpacity>
                  
                  {/* 5-Way Live Toggle Row */}
                  <View style={styles.allocationRow}>
                    {/* Piano */}
                    <TouchableOpacity 
                      style={[
                        styles.allocToggleBtn, 
                        isPiano && { backgroundColor: themeColors.accent }
                      ]}
                      onPress={() => handleToggleTrackRole(lane.index, 'piano')}
                    >
                      <Ionicons name="musical-notes" size={12} color={isPiano ? "#fff" : themeColors.textMuted} />
                    </TouchableOpacity>

                    {/* Speakers (Instruments) */}
                    <TouchableOpacity 
                      style={[
                        styles.allocToggleBtn, 
                        isSpeaker && { backgroundColor: '#a29bfe' }
                      ]}
                      onPress={() => handleToggleTrackRole(lane.index, 'speakers')}
                    >
                      <Ionicons name="volume-high" size={12} color={isSpeaker ? "#fff" : themeColors.textMuted} />
                    </TouchableOpacity>

                    {/* Male Vocal */}
                    <TouchableOpacity 
                      style={[
                        styles.allocToggleBtn, 
                        isMale && { backgroundColor: '#0984e3' }
                      ]}
                      onPress={() => handleToggleTrackRole(lane.index, 'male_vocal')}
                    >
                      <Ionicons name="man" size={12} color={isMale ? "#fff" : themeColors.textMuted} />
                    </TouchableOpacity>

                    {/* Female Vocal */}
                    <TouchableOpacity 
                      style={[
                        styles.allocToggleBtn, 
                        isFemale && { backgroundColor: '#e84393' }
                      ]}
                      onPress={() => handleToggleTrackRole(lane.index, 'female_vocal')}
                    >
                      <Ionicons name="woman" size={12} color={isFemale ? "#fff" : themeColors.textMuted} />
                    </TouchableOpacity>

                    {/* Mute */}
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
              onScroll={handleTimelineScroll}
              scrollEventThrottle={100}
              showsHorizontalScrollIndicator={true}
              style={[styles.lanesScrollView, { backgroundColor: themeColors.background, height: totalHeight }]}
              removeClippedSubviews={true}
            >
              <View style={{ width: timelineWidth, height: totalHeight }}>
              <NoteGrid
                lanesData={getLanesData}
                pianoTracks={pianoTracks}
                speakerTracks={speakerTracks}
                vocalMaleTracks={vocalMaleTracks}
                vocalFemaleTracks={vocalFemaleTracks}
                themeColors={themeColors}
                durationSec={durationSec}
                timelineWidth={timelineWidth}
                totalHeight={totalHeight}
                importedVocalsEnabled={importedVocalsEnabled}
                importedVocalsDelayMs={importedVocalsDelayMs}
                vocalsWaveformEnvelope={vocalsWaveformEnvelope}
                importedVocalsBreaklines={importedVocalsBreaklines}
                loopStartMs={loopStartMs}
                loopEndMs={loopEndMs}
                loopEnabled={loopEnabled}
                laneOffsets={laneOffsets}
                laneHeights={laneHeights}
                finetuneTimeMs={finetuneTimeMs}
                finetuneMode={finetuneMode}
                visibleStartPx={visibleStartPx}
                visibleEndPx={visibleEndPx}
                onUpdateBreakline={handleUpdateBreaklineOffset}
                onDeleteBreakline={handleDeleteBreakline}
                onDeleteLoopStart={handleDeleteLoopStart}
                onDeleteLoopEnd={handleDeleteLoopEnd}
                onLongPressVocals={handleVocalsLongPress}
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

      {/* Sticky Horizontal Navigation & Scrubber Bar for TV Remote & Web Mouse */}
      <View style={{
        ...(Platform.OS === 'web' ? { position: 'sticky', bottom: 0, zIndex: 100 } as any : { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 100 }),
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: themeColors.surface,
        borderTopWidth: 1,
        borderTopColor: themeColors.border,
        boxShadow: '0px -2px 10px rgba(0,0,0,0.15)',
        elevation: 8,
      }}>
        <HoldableButton
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 6,
            backgroundColor: themeColors.surfaceSecondary,
            marginRight: 8,
          }}
          onPressAction={() => panTimelineBy(-10)}
        >
          <Ionicons name="chevron-back" size={16} color={themeColors.accent} />
          <Text style={{ color: themeColors.text, fontSize: 11, fontWeight: 'bold', marginLeft: 2 }}>◄ 10s</Text>
        </HoldableButton>

        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 8 }}>
          <Text style={{ color: themeColors.textMuted, fontSize: 10, fontWeight: 'bold', minWidth: 42 }}>
            {formatTime((visibleScrollX / PIXELS_PER_SECOND) * 1000)}
          </Text>
          
          <Pressable
            style={{ flex: 1, height: 24, justifyContent: 'center', marginHorizontal: 8 }}
            onPress={(e) => {
              const width = e.nativeEvent.target ? (e.nativeEvent.target as any).clientWidth || 300 : 300;
              const x = e.nativeEvent.locationX;
              const ratio = Math.max(0, Math.min(1, x / width));
              const maxScrollX = Math.max(1, timelineWidth - SCREEN_WIDTH + 170);
              const targetX = ratio * maxScrollX;
              scrollRef.current?.scrollTo({ x: targetX, animated: false });
              setVisibleScrollX(targetX);
            }}
          >
            <View style={{ height: 8, backgroundColor: themeColors.border, borderRadius: 4, width: '100%', overflow: 'hidden' }}>
              <View 
                style={{ 
                  height: '100%', 
                  width: `${Math.min(100, Math.max(0, (visibleScrollX / Math.max(1, timelineWidth - SCREEN_WIDTH + 170)) * 100))}%`, 
                  backgroundColor: themeColors.accent 
                }} 
              />
            </View>
          </Pressable>

          <Text style={{ color: themeColors.textMuted, fontSize: 10, fontWeight: 'bold', minWidth: 42, textAlign: 'right' }}>
            {formatTime(durationSec * 1000)}
          </Text>
        </View>

        <HoldableButton
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 6,
            backgroundColor: themeColors.surfaceSecondary,
            marginLeft: 8,
          }}
          onPressAction={() => panTimelineBy(10)}
        >
          <Text style={{ color: themeColors.text, fontSize: 11, fontWeight: 'bold', marginRight: 2 }}>10s ►</Text>
          <Ionicons name="chevron-forward" size={16} color={themeColors.accent} />
        </HoldableButton>
      </View>
    </View>
    );
  };

  const handleExitWorkspace = () => {
    stopPlayback();
    stopPreview();
    setStage('list');
  };
  const renderJobItem = useCallback(({ item }: { item: any }) => {
    const isSelected = selectedJobs.has(item.job_id);
    return (
      <JobCardItem 
        item={item}
        isSelected={isSelected}
        themeColors={themeColors}
        getCleanTitle={getCleanTitle}
        getPlaylistColor={getPlaylistColor}
        getSongLength={getSongLength}
        renderStars={renderStars}
        onPress={() => {
          if (selectedJobs.size > 0) {
            toggleSelect(item.job_id);
          } else {
            handleJobSelect(item);
          }
        }}
        onLongPress={() => toggleSelect(item.job_id)}
        onLogPress={(e: any) => {
          e.stopPropagation();
          setSelectedJobId(item.job_id);
          setShowWorkerLogModal(true);
        }}
      />
    );
  }, [selectedJobs, themeColors, toggleSelect, handleJobSelect]);

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

                <TouchableOpacity style={styles.barBtn} onPress={() => setPlaylistModal({ visible: true, newPlaylistName: '' })}>
                  <Ionicons name="list-outline" size={20} color="#fff" />
                  <Text style={styles.barBtnText}>List</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.barBtn} onPress={handleBulkDelete}>
                  <Ionicons name="trash-outline" size={20} color="#fff" />
                  <Text style={[styles.barBtnText, { color: '#fff' }]}>Delete</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}

          <View style={[styles.header, { borderBottomColor: themeColors.border, borderBottomWidth: 1, paddingBottom: 15, paddingTop: 10, flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <TextInput 
                style={[styles.searchBar, { flex: 1, backgroundColor: themeColors.surface, color: themeColors.text, marginBottom: 0 }]} 
                placeholder="Search jobs..." 
                placeholderTextColor={themeColors.textMuted} 
                value={search} 
                onChangeText={setSearch} 
              />
              <TouchableOpacity 
                onPress={fetchJobs} 
                disabled={loading}
                style={{ padding: 5 }}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={themeColors.accent} />
                ) : (
                  <Ionicons name="refresh" size={24} color={themeColors.accent} />
                )}
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.uploadBtn, { backgroundColor: themeColors.accent, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, height: 42 }]} 
                onPress={handleUpload}
                disabled={loading}
              >
                <Ionicons name="cloud-upload" size={16} color="#fff" style={{ marginRight: 4 }} />
                <Text style={[styles.uploadBtnText, { color: '#fff', fontSize: 13, fontWeight: '600' }]}>Upload</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sortBar}>
              {['name', 'artist', 'rating', 'created', 'length'].map((s) => (
                <TouchableOpacity 
                  key={s} 
                  onPress={() => setSortBy(s as any)} 
                  style={[styles.sortBtn, sortBy === s ? { backgroundColor: themeColors.accent } : { backgroundColor: themeColors.surfaceSecondary }]}
                >
                  <Text style={[styles.sortBtnText, sortBy === s ? { color: '#fff' } : { color: themeColors.text }]}>
                    {s === 'created' ? 'Date' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {loading && jobs.length === 0 ? (
            <ActivityIndicator size="large" color={themeColors.accent} style={{ marginTop: 50 }} />
          ) : (
            <FlatList
              data={filteredJobs}
              keyExtractor={item => item.job_id}
              contentContainerStyle={{ paddingBottom: 100 }}
              extraData={selectedJobs}
              renderItem={renderJobItem}
              initialNumToRender={12}
              maxToRenderPerBatch={10}
              windowSize={11}
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

                    {/* Validated Switch */}
                    <View style={[styles.detailRow, { marginBottom: 20 }]}>
                      <View>
                        <Text style={{ color: themeColors.text, fontWeight: '600' }}>Validated</Text>
                        <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Mark this file as verified and correct</Text>
                      </View>
                      <Switch 
                        value={detailsValidated} 
                        onValueChange={setDetailsValidated} 
                        trackColor={{ false: themeColors.border, true: '#2ecc71' }} 
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
                {getCleanTitle(currentJob.filename)}
              </Text>
              <Text style={[styles.visualizerStateSub, { color: themeColors.textMuted }]}>
                {isPlaying ? 'Playing synced playback' : isPreviewPlaying ? 'Playing preview' : 'Playback stopped'}
              </Text>
            </View>



            {/* Worker Log Button */}
            <TouchableOpacity 
              onPress={() => setShowWorkerLogModal(true)} 
              style={{ 
                marginRight: 12, 
                flexDirection: 'row', 
                alignItems: 'center', 
                backgroundColor: themeColors.surfaceSecondary, 
                paddingHorizontal: 8, 
                paddingVertical: 5, 
                borderRadius: 6,
                borderWidth: 1,
                borderColor: themeColors.border
              }}
            >
              <Ionicons name="terminal-outline" size={16} color={themeColors.accent} style={{ marginRight: 4 }} />
              <Text style={{ fontSize: 11, color: themeColors.text, fontWeight: 'bold' }}>Worker Log</Text>
            </TouchableOpacity>

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
                <HoldableButton 
                  style={[styles.offsetBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                  onPressAction={() => {
                    const current = useStore.getState().midiOrchestrateOffset;
                    setGlobalOffset(current - 10);
                  }}
                >
                  <Text style={[styles.offsetBtnText, { color: themeColors.text }]}>-10ms</Text>
                </HoldableButton>
                <Text style={[styles.offsetValue, { color: themeColors.text, fontWeight: '700' }]}>
                  {globalOffset >= 0 ? `+${globalOffset}` : globalOffset}ms
                </Text>
                <HoldableButton 
                  style={[styles.offsetBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                  onPressAction={() => {
                    const current = useStore.getState().midiOrchestrateOffset;
                    setGlobalOffset(current + 10);
                  }}
                >
                  <Text style={[styles.offsetBtnText, { color: themeColors.text }]}>+10ms</Text>
                </HoldableButton>
              </View>
            </View>
          </View>

          {/* Quick Track Selection & Routing Bar */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 12,
            paddingVertical: 6,
            backgroundColor: themeColors.surfaceSecondary,
            borderBottomWidth: 1,
            borderBottomColor: themeColors.border
          }}>
            <Text style={{ fontSize: 11, fontWeight: 'bold', color: themeColors.textMuted }}>
              Track Routing:
            </Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: speakerTracks.size === getLanesData.filter(l => l.index >= 0).length ? themeColors.accent : themeColors.surface,
                  borderWidth: 1,
                  borderColor: themeColors.border
                }}
                onPress={() => selectAllTracksForRole('speakers')}
              >
                <Ionicons name="volume-high" size={12} color={speakerTracks.size === getLanesData.filter(l => l.index >= 0).length ? '#fff' : themeColors.text} />
                <Text style={{ fontSize: 11, color: speakerTracks.size === getLanesData.filter(l => l.index >= 0).length ? '#fff' : themeColors.text, fontWeight: '600' }}>
                  All Speakers
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: pianoTracks.size === getLanesData.filter(l => l.index >= 0).length ? '#00b894' : themeColors.surface,
                  borderWidth: 1,
                  borderColor: themeColors.border
                }}
                onPress={() => selectAllTracksForRole('piano')}
              >
                <Ionicons name="musical-notes" size={12} color={pianoTracks.size === getLanesData.filter(l => l.index >= 0).length ? '#fff' : themeColors.text} />
                <Text style={{ fontSize: 11, color: pianoTracks.size === getLanesData.filter(l => l.index >= 0).length ? '#fff' : themeColors.text, fontWeight: '600' }}>
                  All Piano
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: (pianoTracks.size === 0 && speakerTracks.size === 0 && vocalMaleTracks.size === 0 && vocalFemaleTracks.size === 0) ? '#ff7675' : themeColors.surface,
                  borderWidth: 1,
                  borderColor: themeColors.border
                }}
                onPress={() => selectAllTracksForRole('off')}
              >
                <Ionicons name="volume-mute" size={12} color={(pianoTracks.size === 0 && speakerTracks.size === 0 && vocalMaleTracks.size === 0 && vocalFemaleTracks.size === 0) ? '#fff' : themeColors.text} />
                <Text style={{ fontSize: 11, color: (pianoTracks.size === 0 && speakerTracks.size === 0 && vocalMaleTracks.size === 0 && vocalFemaleTracks.size === 0) ? '#fff' : themeColors.text, fontWeight: '600' }}>
                  Mute All / Off
                </Text>
              </TouchableOpacity>
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

              {/* MP3 Vocal Import Section */}
              <View style={{ height: 1, backgroundColor: themeColors.border, marginVertical: 12, opacity: 0.6 }} />

              <View style={[styles.settingItemRow, { flexDirection: 'column', alignItems: 'stretch' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={[styles.settingItemLabel, { color: themeColors.text, fontWeight: 'bold' }]}>
                    MP3 Vocal Stem
                  </Text>
                  {importedVocalsJobId ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                       <TouchableOpacity 
                         onPress={handleOpenMp3ImportModal}
                         style={{ marginRight: 2 }}
                       >
                         <Ionicons name="swap-horizontal" size={18} color={themeColors.text} />
                       </TouchableOpacity>
                      <Switch
                        value={importedVocalsEnabled}
                        onValueChange={setImportedVocalsEnabled}
                        trackColor={{ false: themeColors.border, true: '#e84393' }}
                        thumbColor="#fff"
                      />
                       <TouchableOpacity 
                         onPress={() => {
                           setImportedVocalsJobId(null);
                           setImportedVocalsOriginalName(null);
                           setVocalsWaveformEnvelope(null);
                           setImportedVocalsBreaklines([]);
                         }}
                       >
                         <Ionicons name="trash-outline" size={18} color="#ff7675" />
                       </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={{ backgroundColor: themeColors.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                      onPress={handleOpenMp3ImportModal}
                    >
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>Link MP3 Vocals</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {importedVocalsJobId && (
                  <View style={{ marginTop: 4 }}>
                    <Text style={{ fontSize: 11, color: themeColors.textMuted, marginBottom: 8 }} numberOfLines={1}>
                      Linked: {importedVocalsOriginalName || `${importedVocalsJobId.slice(0, 18)}...`}
                    </Text>

                    {/* Volume buttons */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 6 }}>
                      <Text style={{ fontSize: 11, color: themeColors.text, width: 75 }}>Vocal Volume:</Text>
                      
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <TouchableOpacity 
                          style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: themeColors.surface, borderRadius: 6, borderWidth: 1, borderColor: themeColors.border }}
                          onPress={() => setImportedVocalsVolumeFactor(prev => Math.max(0.0, Number((prev - 0.1).toFixed(1))))}
                        >
                          <Ionicons name="remove" size={12} color={themeColors.text} />
                        </TouchableOpacity>

                        <Text style={{ fontSize: 11, color: themeColors.text, fontWeight: 'bold', minWidth: 45, textAlign: 'center' }}>
                          {Math.round(importedVocalsVolumeFactor * 100)}%
                        </Text>

                        <TouchableOpacity 
                          style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: themeColors.surface, borderRadius: 6, borderWidth: 1, borderColor: themeColors.border }}
                          onPress={() => setImportedVocalsVolumeFactor(prev => Math.min(2.0, Number((prev + 0.1).toFixed(1))))}
                        >
                          <Ionicons name="add" size={12} color={themeColors.text} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                )}

                {/* Orchestral DSP & Master Reverb Section */}
                <View style={{ height: 1, backgroundColor: themeColors.border, marginVertical: 12, opacity: 0.6 }} />

                <View style={[styles.settingItemRow, { flexDirection: 'column', alignItems: 'stretch' }]}>
                  <Text style={[styles.settingItemLabel, { color: themeColors.text, fontWeight: 'bold', marginBottom: 6 }]}>
                    Orchestral DSP & Master Reverb
                  </Text>

                  {/* Reverb Toggle & Presets */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="sparkles-outline" size={16} color={themeColors.accent} />
                      <Text style={{ fontSize: 12, color: themeColors.text, fontWeight: '600' }}>
                        AIR Studios Reverb Essentials
                      </Text>
                    </View>
                    <Switch
                      value={reverbEnabled}
                      onValueChange={handleToggleReverb}
                      trackColor={{ false: themeColors.border, true: themeColors.accent }}
                      thumbColor="#fff"
                    />
                  </View>

                  {reverbEnabled && (
                    <View style={{ marginTop: 8 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ fontSize: 11, color: themeColors.textMuted }}>Reverb Preset:</Text>
                        {isUpdatingReverb && (
                          <ActivityIndicator size="small" color={themeColors.accent} />
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        {(reverbPresets.length > 0 ? reverbPresets : [
                          { id: 'none', filename: 'none', title: 'Dry (No Reverb)' },
                          { id: 'AIR Studios Reverb Essentials - Intimate Close.vstpreset', filename: 'AIR Studios Reverb Essentials - Intimate Close.vstpreset', title: 'Intimate Close' }
                        ]).map((preset) => {
                          const isSel = selectedReverbPreset === preset.filename;
                          return (
                            <TouchableOpacity
                              key={preset.filename}
                              disabled={isUpdatingReverb}
                              style={[
                                styles.presetBadge,
                                isSel ? { backgroundColor: themeColors.accent, borderColor: themeColors.accent } : { backgroundColor: themeColors.surface }
                              ]}
                              onPress={() => setSelectedReverbPreset(preset.filename)}
                            >
                              <Text style={[styles.presetBadgeText, { color: isSel ? '#fff' : themeColors.text }]}>
                                {preset.title}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Explicit Update Reverb Backing File Button */}
                      <TouchableOpacity
                        disabled={isUpdatingReverb || !selectedJobId}
                        style={{
                          backgroundColor: themeColors.accent,
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                          borderRadius: 6,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          marginTop: 10,
                          opacity: (isUpdatingReverb || !selectedJobId) ? 0.6 : 1.0
                        }}
                        onPress={() => handleUpdateReverbPreset(selectedReverbPreset)}
                      >
                        {isUpdatingReverb ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Ionicons name="refresh-outline" size={14} color="#fff" />
                        )}
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>
                          {isUpdatingReverb ? 'Updating Reverb Backing File...' : 'Update Reverb Backing File'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Peak Volume Ceiling / Headroom */}
                  <View style={{ marginTop: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ fontSize: 11, color: themeColors.textMuted }}>Peak Volume Headroom:</Text>
                      <Text style={{ fontSize: 11, color: themeColors.text, fontWeight: 'bold' }}>
                        {peakCeilingDb.toFixed(1)} dB
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {[
                        { label: 'Subtle (-9 dB)', val: -9.0 },
                        { label: 'Balanced (-6 dB)', val: -6.0 },
                        { label: 'Loud (-3 dB)', val: -3.0 },
                        { label: 'Max (0 dB)', val: 0.0 }
                      ].map((preset) => {
                        const isSel = Math.abs(peakCeilingDb - preset.val) < 0.5;
                        return (
                          <TouchableOpacity
                            key={preset.label}
                            style={[
                              styles.presetBadge,
                              isSel ? { backgroundColor: themeColors.accent, borderColor: themeColors.accent } : { backgroundColor: themeColors.surface }
                            ]}
                            onPress={() => handleChangePeakCeiling(preset.val)}
                          >
                            <Text style={[styles.presetBadgeText, { color: isSel ? '#fff' : themeColors.text }]}>
                              {preset.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
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
              
              {currentJob.status === 'completed' && !hasChanges ? (
                <TouchableOpacity 
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: themeColors.surfaceSecondary, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 }}
                  onPress={() => setPlaybackMode(prev => prev === 'preview' ? 'performance' : 'preview')}
                >
                  <Ionicons 
                    name={playbackMode === 'preview' ? "volume-medium" : "musical-notes"} 
                    size={14} 
                    color={playbackMode === 'preview' ? '#a29bfe' : themeColors.accent} 
                  />
                  <Text style={[styles.modeIndicatorText, { color: playbackMode === 'preview' ? '#a29bfe' : themeColors.accent, fontSize: 11 }]}>
                    {playbackMode === 'preview' ? 'Phone Speakers' : 'Disklavier Piano'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={[styles.modeIndicatorText, { color: '#a29bfe' }]}>
                  Preview Mode
                </Text>
              )}
              
              <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>{formatTime(playbackDuration)}</Text>
            </View>

            {/* Loop Markers Bar */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: themeColors.border, opacity: 0.9 }}>
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: loopStartMs !== null ? 'rgba(46, 204, 113, 0.2)' : themeColors.surfaceSecondary,
                  borderWidth: 1,
                  borderColor: loopStartMs !== null ? '#2ecc71' : themeColors.border
                }}
                onPress={() => setLoopStartMs(Math.round(playbackPos))}
              >
                <Ionicons name="flag" size={12} color={loopStartMs !== null ? '#2ecc71' : themeColors.text} />
                <Text style={{ fontSize: 10, color: themeColors.text, fontWeight: '600' }}>
                  {loopStartMs !== null ? `Start: ${formatTime(loopStartMs)}` : 'Set A'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: loopEndMs !== null ? 'rgba(231, 76, 60, 0.2)' : themeColors.surfaceSecondary,
                  borderWidth: 1,
                  borderColor: loopEndMs !== null ? '#e74c3c' : themeColors.border
                }}
                onPress={() => setLoopEndMs(Math.round(playbackPos))}
              >
                <Ionicons name="flag" size={12} color={loopEndMs !== null ? '#e74c3c' : themeColors.text} />
                <Text style={{ fontSize: 10, color: themeColors.text, fontWeight: '600' }}>
                  {loopEndMs !== null ? `End: ${formatTime(loopEndMs)}` : 'Set B'}
                </Text>
              </TouchableOpacity>

              {(loopStartMs !== null || loopEndMs !== null) && (
                <TouchableOpacity
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 4,
                    borderRadius: 6,
                    backgroundColor: themeColors.surfaceSecondary
                  }}
                  onPress={() => {
                    setLoopStartMs(null);
                    setLoopEndMs(null);
                    setLoopEnabled(false);
                  }}
                >
                  <Ionicons name="close-circle-outline" size={14} color="#ff7675" />
                </TouchableOpacity>
              )}

              <View style={{ width: 1, height: 16, backgroundColor: themeColors.border }} />

              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: loopEnabled ? 'rgba(46, 204, 113, 0.15)' : themeColors.surfaceSecondary,
                  borderWidth: 1,
                  borderColor: loopEnabled ? '#2ecc71' : themeColors.border
                }}
                disabled={loopStartMs === null || loopEndMs === null}
                onPress={() => setLoopEnabled(prev => !prev)}
              >
                <Ionicons name="repeat" size={12} color={loopEnabled ? '#2ecc71' : themeColors.text} />
                <Text style={{ fontSize: 10, color: loopEnabled ? '#2ecc71' : themeColors.text, fontWeight: 'bold' }}>
                  {loopEnabled ? 'Loop On' : 'Loop Off'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Main Buttons */}
            <View style={styles.buttonsRow}>
              {/* Always show Synthesize button to the left of the stop button */}
              <TouchableOpacity 
                style={[styles.miniProcessBtn, { backgroundColor: themeColors.accent, marginRight: 10, marginLeft: 0 }]}
                onPress={handleProcess}
                disabled={loading || isPreviewPlaying || isPlaying}
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

              {playbackMode === 'preview' ? (
                // PREVIEW PLAY BUTTONS
                <>
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 8,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: fullPreviewMode ? 'rgba(162, 155, 254, 0.25)' : themeColors.surfaceSecondary,
                      borderWidth: 1,
                      borderColor: fullPreviewMode ? '#a29bfe' : themeColors.border,
                      marginRight: 6
                    }}
                    onPress={() => setFullPreviewMode(prev => !prev)}
                  >
                    <Ionicons name={fullPreviewMode ? "infinite-outline" : "timer-outline"} size={14} color={fullPreviewMode ? '#a29bfe' : themeColors.text} style={{ marginRight: 4 }} />
                    <Text style={{ fontSize: 11, color: fullPreviewMode ? '#a29bfe' : themeColors.text, fontWeight: 'bold' }}>
                      {fullPreviewMode ? 'Full Preview' : '60s Preview'}
                    </Text>
                  </TouchableOpacity>

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
                </>
              ) : (
                // PERFORMANCE PLAY BUTTONS
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

          {/* Floating Markers Tooltip Popup (Top) */}
          {showTooltip && (
            <View style={{
              position: 'absolute',
              top: 50,
              left: 15,
              right: 15,
              backgroundColor: themeColors.surface,
              borderRadius: 12,
              padding: 12,
              borderWidth: 1.5,
              borderColor: themeColors.border,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 5,
              elevation: 10,
              zIndex: 1000,
              flexDirection: 'column',
              gap: 8
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: themeColors.text, fontWeight: 'bold', fontSize: 13 }}>
                  Vocal Marker: {formatTime(tooltipTimeMs)}
                </Text>
                <TouchableOpacity onPress={() => setShowTooltip(false)}>
                  <Ionicons name="close" size={20} color={themeColors.textMuted} />
                </TouchableOpacity>
              </View>
              
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                <TouchableOpacity
                  style={{ backgroundColor: '#e84393', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 }}
                  onPress={() => {
                    setShowTooltip(false);
                    setFinetuneMode('breakline');
                    setFinetuneTimeMs(tooltipTimeMs);
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>+ Breakline</Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <TouchableOpacity
                    style={{ backgroundColor: '#2ecc71', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 }}
                    onPress={() => {
                      setShowTooltip(false);
                      setFinetuneMode('loopStart');
                      setFinetuneTimeMs(tooltipTimeMs);
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>+ Loop A</Text>
                  </TouchableOpacity>
                  {loopStartMs !== null && (
                    <TouchableOpacity 
                      style={{ padding: 4, backgroundColor: themeColors.surfaceSecondary, borderRadius: 6 }}
                      onPress={() => {
                        setLoopStartMs(null);
                        setLoopEnabled(false);
                      }}
                    >
                      <Ionicons name="trash-outline" size={14} color="#ff7675" />
                    </TouchableOpacity>
                  )}
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <TouchableOpacity
                    style={{ backgroundColor: '#e74c3c', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 }}
                    onPress={() => {
                      setShowTooltip(false);
                      setFinetuneMode('loopEnd');
                      setFinetuneTimeMs(tooltipTimeMs);
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>+ Loop B</Text>
                  </TouchableOpacity>
                  {loopEndMs !== null && (
                    <TouchableOpacity 
                      style={{ padding: 4, backgroundColor: themeColors.surfaceSecondary, borderRadius: 6 }}
                      onPress={() => {
                        setLoopEndMs(null);
                        setLoopEnabled(false);
                      }}
                    >
                      <Ionicons name="trash-outline" size={14} color="#ff7675" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* Floating Finetuning controls (Bottom) */}
          {finetuneMode !== null && (
            <View style={{
              position: 'absolute',
              bottom: 110,
              left: 15,
              right: 15,
              backgroundColor: themeColors.surface,
              borderRadius: 12,
              padding: 12,
              borderWidth: 1.5,
              borderColor: themeColors.border,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.3,
              shadowRadius: 5,
              elevation: 10,
              zIndex: 1000,
              flexDirection: 'column',
              gap: 8,
              alignItems: 'center'
            }}>
              <Text style={{ color: themeColors.text, fontWeight: 'bold', fontSize: 12 }}>
                Finetuning {finetuneMode === 'breakline' ? 'Breakline' : finetuneMode === 'loopStart' ? 'Loop A' : 'Loop B'}: {formatTime(finetuneTimeMs)}
              </Text>
              
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', marginVertical: 4 }}>
                {/* Decrements */}
                {[-50, -10, -1].map(val => (
                  <TouchableOpacity
                    key={`fdec-${val}`}
                    style={{ paddingHorizontal: 8, paddingVertical: 6, backgroundColor: themeColors.surfaceSecondary, borderRadius: 6, borderWidth: 1, borderColor: themeColors.border }}
                    onPress={() => setFinetuneTimeMs(prev => Math.max(0, prev + val))}
                  >
                    <Text style={{ fontSize: 10, color: themeColors.text }}>{val}ms</Text>
                  </TouchableOpacity>
                ))}

                {/* Increments */}
                {[1, 10, 50].map(val => (
                  <TouchableOpacity
                    key={`finc-${val}`}
                    style={{ paddingHorizontal: 8, paddingVertical: 6, backgroundColor: themeColors.surfaceSecondary, borderRadius: 6, borderWidth: 1, borderColor: themeColors.border }}
                    onPress={() => setFinetuneTimeMs(prev => prev + val)}
                  >
                    <Text style={{ fontSize: 10, color: themeColors.text }}>+{val}ms</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                <TouchableOpacity
                  style={{ backgroundColor: themeColors.border, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 }}
                  onPress={() => setFinetuneMode(null)}
                >
                  <Text style={{ color: themeColors.text, fontSize: 12, fontWeight: 'bold' }}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{ backgroundColor: themeColors.accent, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 }}
                  onPress={() => {
                    const targetTime = finetuneTimeMs;
                    if (finetuneMode === 'breakline') {
                      let initialOffset = importedVocalsDelayMs;
                      const sorted = [...importedVocalsBreaklines].sort((a,b) => a.time_ms - b.time_ms);
                      for (const b of sorted) {
                        if (b.time_ms < targetTime) {
                          initialOffset = b.offset_ms;
                        } else {
                          break;
                        }
                      }
                      
                      const updated = [...importedVocalsBreaklines, { time_ms: targetTime, offset_ms: initialOffset }]
                        .sort((a, b) => a.time_ms - b.time_ms);
                      setImportedVocalsBreaklines(updated);
                    } else if (finetuneMode === 'loopStart') {
                      setLoopStartMs(targetTime);
                    } else if (finetuneMode === 'loopEnd') {
                      setLoopEndMs(targetTime);
                    }
                    setFinetuneMode(null);
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>Accept</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* MP3 Vocal Stem Selection Modal */}
          <Modal
            visible={showMp3ImportModal}
            transparent
            animationType="slide"
            onRequestClose={() => setShowMp3ImportModal(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { backgroundColor: themeColors.surface, maxHeight: '80%' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                  <Text style={[styles.modalTitle, { color: themeColors.text }]}>Link MP3 Vocals</Text>
                  <TouchableOpacity onPress={() => setShowMp3ImportModal(false)}>
                    <Ionicons name="close" size={24} color={themeColors.text} />
                  </TouchableOpacity>
                </View>

                {mp3Jobs.length === 0 ? (
                  <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                    <Ionicons name="cloud-offline-outline" size={48} color={themeColors.textMuted} />
                    <Text style={{ color: themeColors.textMuted, marginTop: 10, textAlign: 'center' }}>
                      No completed MP3 separation jobs found.
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={mp3Jobs}
                    keyExtractor={(item) => item.job_id}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={{
                          padding: 12,
                          borderBottomWidth: 1,
                          borderBottomColor: themeColors.border,
                          backgroundColor: themeColors.surfaceSecondary,
                          borderRadius: 8,
                          marginBottom: 8
                        }}
                        onPress={() => handleSelectMp3Vocals(item.job_id)}
                      >
                        <Text style={{ color: themeColors.text, fontWeight: 'bold', fontSize: 13 }} numberOfLines={1}>
                          {item.original_name || item.filename || 'Untitled MP3 Job'}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 15, marginTop: 4 }}>
                          <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>
                            ID: {item.job_id.slice(0, 8)}
                          </Text>
                          {item.artist && (
                            <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>
                              Artist: {item.artist}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    )}
                    style={{ maxHeight: 350 }}
                  />
                )}

                <TouchableOpacity 
                  style={[styles.modalBtn, { backgroundColor: themeColors.accent, marginTop: 15 }]} 
                  onPress={() => setShowMp3ImportModal(false)}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* Track Settings & Customization Modal */}
          <Modal
            visible={editingTrackIndex !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setEditingTrackIndex(null)}
          >
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { backgroundColor: themeColors.surface, maxWidth: 480, width: '90%', padding: 20, borderRadius: 16 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                  <Text style={[styles.modalTitle, { color: themeColors.text, fontSize: 16 }]}>
                    Track {editingTrackIndex !== null ? editingTrackIndex : ''} Settings
                  </Text>
                  <TouchableOpacity onPress={() => setEditingTrackIndex(null)}>
                    <Ionicons name="close" size={24} color={themeColors.text} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
                  {/* Original Track Information Card */}
                  {editingTrackInfo && (
                    <View style={{ backgroundColor: themeColors.surfaceSecondary, borderRadius: 10, padding: 12, marginBottom: 15, borderLeftWidth: 3, borderLeftColor: themeColors.accent }}>
                      <Text style={{ fontSize: 11, fontWeight: 'bold', color: themeColors.accent, textTransform: 'uppercase', marginBottom: 4 }}>
                        Original MIDI Track Details
                      </Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: themeColors.text, marginBottom: 2 }}>
                        📌 Track Title: {editingTrackInfo.display_name || editingTrackInfo.name || 'Unnamed Track'}
                      </Text>
                      {!!editingTrackInfo.instrument_name && (
                        <Text style={{ fontSize: 12, color: themeColors.textMuted, marginBottom: 2 }}>
                          🎻 MIDI Instrument: {editingTrackInfo.instrument_name} (Program #{editingTrackInfo.program})
                        </Text>
                      )}
                      <Text style={{ fontSize: 11, color: themeColors.textMuted }}>
                        🎵 Track Index #{editingTrackIndex} • {editingTrackInfo.is_drum ? 'Percussion / Drums' : `${editingTrackInfo.note_count || 0} notes`}
                      </Text>
                    </View>
                  )}

                  {/* Custom Track Name */}
                  <View style={{ marginBottom: 15 }}>
                    <Text style={[styles.label, { color: themeColors.text, marginBottom: 6, fontSize: 12, fontWeight: 'bold' }]}>Custom Track Name</Text>
                    <TextInput
                      style={[styles.searchBar, { backgroundColor: themeColors.surfaceSecondary, color: themeColors.text, marginBottom: 0, height: 40, borderRadius: 8, paddingHorizontal: 12 }]}
                      placeholder="e.g. Solo Cello, Violin 1 Lead..."
                      placeholderTextColor={themeColors.textMuted}
                      value={editingTrackIndex !== null ? (tracksConfig[String(editingTrackIndex)]?.name || '') : ''}
                      onChangeText={(txt) => {
                        if (editingTrackIndex === null) return;
                        setTracksConfig(prev => ({
                          ...prev,
                          [String(editingTrackIndex)]: { ...prev[String(editingTrackIndex)], name: txt }
                        }));
                      }}
                    />
                  </View>



                  {/* Categorized Orchestrator Instrument Patch / Performer Selector */}
                  <View style={{ marginBottom: 15 }}>
                    <Text style={[styles.label, { color: themeColors.text, marginBottom: 6, fontSize: 12, fontWeight: 'bold' }]}>
                      Instrument Category & Preset
                    </Text>
                    
                    {/* Tier 1: Category Selector Pills */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', paddingVertical: 4, marginBottom: 8 }}>
                      <TouchableOpacity
                        style={[
                          styles.presetBadge,
                          selectedVstCategory === 'Auto' ? { backgroundColor: themeColors.accent, borderColor: themeColors.accent } : { backgroundColor: themeColors.surfaceSecondary }
                        ]}
                        onPress={() => setSelectedVstCategory('Auto')}
                      >
                        <Text style={[styles.presetBadgeText, { color: selectedVstCategory === 'Auto' ? '#fff' : themeColors.text, fontWeight: 'bold' }]}>
                          Auto (GM)
                        </Text>
                      </TouchableOpacity>

                      {Object.keys(vstCategories).map((catName) => {
                        const isCatSel = selectedVstCategory === catName;
                        return (
                          <TouchableOpacity
                            key={catName}
                            style={[
                              styles.presetBadge,
                              isCatSel ? { backgroundColor: themeColors.accent, borderColor: themeColors.accent } : { backgroundColor: themeColors.surfaceSecondary }
                            ]}
                            onPress={() => setSelectedVstCategory(catName)}
                          >
                            <Text style={[styles.presetBadgeText, { color: isCatSel ? '#fff' : themeColors.text, fontWeight: 'bold' }]}>
                              {catName}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>

                    {/* Tier 2: Instrument Options inside Selected Category */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                      {selectedVstCategory === 'Auto' ? (
                        <TouchableOpacity
                          style={[
                            styles.presetBadge,
                            (editingTrackIndex !== null && (tracksConfig[String(editingTrackIndex)]?.instrument_patch || 'auto') === 'auto')
                              ? { backgroundColor: themeColors.accent, borderColor: themeColors.accent }
                              : { backgroundColor: themeColors.surfaceSecondary }
                          ]}
                          onPress={() => {
                            if (editingTrackIndex === null) return;
                            setTracksConfig(prev => ({
                              ...prev,
                              [String(editingTrackIndex)]: { ...prev[String(editingTrackIndex)], instrument_patch: 'auto' }
                            }));
                          }}
                        >
                          <Text style={[styles.presetBadgeText, { color: (editingTrackIndex !== null && (tracksConfig[String(editingTrackIndex)]?.instrument_patch || 'auto') === 'auto') ? '#fff' : themeColors.text }]}>
                            Auto (Detect from Track)
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        (vstCategories[selectedVstCategory] || []).map((instItem) => {
                          const curPatch = editingTrackIndex !== null ? (tracksConfig[String(editingTrackIndex)]?.instrument_patch || 'auto') : 'auto';
                          const isSel = curPatch === instItem.id || curPatch === instItem.filename;
                          return (
                            <TouchableOpacity
                              key={instItem.filename}
                              style={[
                                styles.presetBadge,
                                isSel ? { backgroundColor: themeColors.accent, borderColor: themeColors.accent } : { backgroundColor: themeColors.surfaceSecondary }
                              ]}
                              onPress={() => {
                                if (editingTrackIndex === null) return;
                                setTracksConfig(prev => ({
                                  ...prev,
                                  [String(editingTrackIndex)]: { ...prev[String(editingTrackIndex)], instrument_patch: instItem.id }
                                }));
                              }}
                            >
                              <Text style={[styles.presetBadgeText, { color: isSel ? '#fff' : themeColors.text }]}>
                                {instItem.title}
                              </Text>
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </ScrollView>
                  </View>

                  {/* Track Gain / Volume Stepper */}
                  <View style={{ marginBottom: 15 }}>
                    <Text style={[styles.label, { color: themeColors.text, marginBottom: 6, fontSize: 12, fontWeight: 'bold' }]}>
                      Track Volume: {Math.round((editingTrackIndex !== null ? (tracksConfig[String(editingTrackIndex)]?.gain ?? 1.0) : 1.0) * 100)}%
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: themeColors.surfaceSecondary, borderRadius: 8, padding: 4 }}>
                      <TouchableOpacity
                        style={{ padding: 6 }}
                        onPress={() => {
                          if (editingTrackIndex === null) return;
                          const cur = tracksConfig[String(editingTrackIndex)]?.gain ?? 1.0;
                          const nextGain = Math.max(0.1, Number((cur - 0.1).toFixed(2)));
                          setTracksConfig(prev => ({
                            ...prev,
                            [String(editingTrackIndex)]: { ...prev[String(editingTrackIndex)], gain: nextGain }
                          }));
                        }}
                      >
                        <Ionicons name="remove-circle-outline" size={26} color={themeColors.accent} />
                      </TouchableOpacity>
                      <Text style={{ color: themeColors.text, fontWeight: 'bold', fontSize: 15 }}>
                        {Math.round((editingTrackIndex !== null ? (tracksConfig[String(editingTrackIndex)]?.gain ?? 1.0) : 1.0) * 100)}%
                      </Text>
                      <TouchableOpacity
                        style={{ padding: 6 }}
                        onPress={() => {
                          if (editingTrackIndex === null) return;
                          const cur = tracksConfig[String(editingTrackIndex)]?.gain ?? 1.0;
                          const nextGain = Math.min(2.0, Number((cur + 0.1).toFixed(2)));
                          setTracksConfig(prev => ({
                            ...prev,
                            [String(editingTrackIndex)]: { ...prev[String(editingTrackIndex)], gain: nextGain }
                          }));
                        }}
                      >
                        <Ionicons name="add-circle-outline" size={26} color={themeColors.accent} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Articulation Selector */}
                  <View style={{ marginBottom: 15 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text style={[styles.label, { color: themeColors.text, fontSize: 12, fontWeight: 'bold', marginBottom: 0 }]}>
                        Articulation / Playing Technique
                      </Text>
                      <View style={{ backgroundColor: themeColors.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: themeColors.border }}>
                        <Text style={{ fontSize: 11, color: themeColors.accent, fontWeight: '700' }}>
                          {getActiveTrackCategory()}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {getAvailableArticulations().map(art => {
                        const curArt = editingTrackIndex !== null ? (tracksConfig[String(editingTrackIndex)]?.articulation || 'auto') : 'auto';
                        const isSelected = curArt === art.id;
                        return (
                          <TouchableOpacity
                            key={art.id}
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              borderRadius: 6,
                              backgroundColor: isSelected ? themeColors.accent : themeColors.surfaceSecondary,
                              borderWidth: 1,
                              borderColor: isSelected ? themeColors.accent : themeColors.border
                            }}
                            onPress={() => {
                              if (editingTrackIndex === null) return;
                              setTracksConfig(prev => ({
                                ...prev,
                                [String(editingTrackIndex)]: { ...prev[String(editingTrackIndex)], articulation: art.id }
                              }));
                            }}
                          >
                            <Text style={{ fontSize: 11, color: isSelected ? '#fff' : themeColors.text, fontWeight: isSelected ? 'bold' : '500' }}>
                              {art.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  {/* Track Pitch / Transpose Stepper */}
                  <View style={{ marginBottom: 15 }}>
                    <Text style={[styles.label, { color: themeColors.text, marginBottom: 6, fontSize: 12, fontWeight: 'bold' }]}>
                      Octave / Pitch Transpose: {editingTrackIndex !== null ? (tracksConfig[String(editingTrackIndex)]?.transpose ?? 0) : 0} semitones
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: themeColors.surfaceSecondary, borderRadius: 8, padding: 4 }}>
                      <TouchableOpacity
                        style={{ padding: 6 }}
                        onPress={() => {
                          if (editingTrackIndex === null) return;
                          const cur = tracksConfig[String(editingTrackIndex)]?.transpose ?? 0;
                          setTracksConfig(prev => ({
                            ...prev,
                            [String(editingTrackIndex)]: { ...prev[String(editingTrackIndex)], transpose: Math.max(-24, cur - 1) }
                          }));
                        }}
                      >
                        <Ionicons name="remove-circle-outline" size={26} color={themeColors.accent} />
                      </TouchableOpacity>
                      <Text style={{ color: themeColors.text, fontWeight: 'bold', fontSize: 15 }}>
                        {(editingTrackIndex !== null ? (tracksConfig[String(editingTrackIndex)]?.transpose ?? 0) : 0) >= 0 ? `+${editingTrackIndex !== null ? (tracksConfig[String(editingTrackIndex)]?.transpose ?? 0) : 0}` : tracksConfig[String(editingTrackIndex)]?.transpose} st
                      </Text>
                      <TouchableOpacity
                        style={{ padding: 6 }}
                        onPress={() => {
                          if (editingTrackIndex === null) return;
                          const cur = tracksConfig[String(editingTrackIndex)]?.transpose ?? 0;
                          setTracksConfig(prev => ({
                            ...prev,
                            [String(editingTrackIndex)]: { ...prev[String(editingTrackIndex)], transpose: Math.min(24, cur + 1) }
                          }));
                        }}
                      >
                        <Ionicons name="add-circle-outline" size={26} color={themeColors.accent} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </ScrollView>

                {/* Footer Action Buttons */}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 15 }}>
                  {/* Reset to Default Button */}
                  <TouchableOpacity
                    style={[styles.uploadBtn, { backgroundColor: themeColors.surfaceSecondary, flex: 1, height: 42, justifyContent: 'center', borderRadius: 8 }]}
                    onPress={async () => {
                      if (editingTrackIndex === null) return;
                      setTracksConfig(prev => {
                        const copy = { ...prev };
                        delete copy[String(editingTrackIndex)];
                        if (selectedJobId) {
                          midiOrchestratorApi.updateMetadata(selectedJobId, { tracks_config: copy }).catch(console.error);
                          setJobs(jList => jList.map(j => j.job_id === selectedJobId ? { ...j, tracks_config: copy } : j));
                        }
                        return copy;
                      });
                      setEditingTrackIndex(null);
                    }}
                  >
                    <Text style={[styles.uploadBtnText, { color: themeColors.text, fontSize: 13, fontWeight: 'bold', textAlign: 'center' }]}>Reset to Default</Text>
                  </TouchableOpacity>

                  {/* Save Track Settings Button */}
                  <TouchableOpacity
                    style={[styles.uploadBtn, { backgroundColor: themeColors.accent, flex: 1, height: 42, justifyContent: 'center', borderRadius: 8 }]}
                    onPress={async () => {
                      if (selectedJobId) {
                        try {
                          await midiOrchestratorApi.updateMetadata(selectedJobId, { tracks_config: tracksConfig });
                          setJobs(prev => prev.map(j => j.job_id === selectedJobId ? { ...j, tracks_config: tracksConfig } : j));
                        } catch (e) {
                          console.error('Failed to save tracks_config:', e);
                        }
                      }
                      setEditingTrackIndex(null);
                    }}
                  >
                    <Text style={[styles.uploadBtnText, { color: '#fff', fontSize: 13, fontWeight: 'bold', textAlign: 'center' }]}>Save Settings</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>



        </View>
      )}

      {/* Worker Log Modal (Global Root) */}
      <Modal
        visible={showWorkerLogModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWorkerLogModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: themeColors.surface, width: '92%', maxHeight: '85%', padding: 18, borderRadius: 16 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="terminal-outline" size={22} color={themeColors.accent} style={{ marginRight: 8 }} />
                <Text style={[styles.modalTitle, { color: themeColors.text, marginBottom: 0, fontSize: 16 }]}>Worker Process Log</Text>
              </View>
              <TouchableOpacity onPress={() => setShowWorkerLogModal(false)}>
                <Ionicons name="close" size={24} color={themeColors.text} />
              </TouchableOpacity>
            </View>

            {/* Status Indicator */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 8, paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 11, color: themeColors.textMuted, fontWeight: 'bold' }}>
                Job ID: {selectedJobId?.slice(0, 12)}...
              </Text>
              {isFetchingWorkerLog && <ActivityIndicator size="small" color={themeColors.accent} />}
            </View>

            {/* Console Log Window */}
            <ScrollView 
              style={{ 
                width: '100%', 
                maxHeight: 380, 
                backgroundColor: '#1e1e1e', 
                borderRadius: 8, 
                padding: 12, 
                marginVertical: 8 
              }}
              contentContainerStyle={{ flexGrow: 1 }}
            >
              <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 11, color: '#00ff66', lineHeight: 16 }}>
                {workerLogText || 'Waiting for process logs...'}
              </Text>
            </ScrollView>

            {/* Bottom Actions */}
            <View style={{ flexDirection: 'row', gap: 10, width: '100%', marginTop: 10 }}>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: '#ff7675', flex: 1, paddingVertical: 10 }]}
                onPress={() => {
                  if (selectedJobId) {
                    midiOrchestratorApi.cancelJob(selectedJobId).catch(() => {});
                    setShowWorkerLogModal(false);
                  }
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 12 }}>Cancel Active Process</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: themeColors.border, flex: 1, paddingVertical: 10 }]}
                onPress={() => setShowWorkerLogModal(false)}
              >
                <Text style={{ color: themeColors.text, fontWeight: 'bold', fontSize: 12 }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Synthesis Conflict Modal (Global Root) */}
      <Modal
        visible={showConflictModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConflictModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: themeColors.surface, width: '88%', padding: 20, borderRadius: 16 }]}>
            <Ionicons name="warning-outline" size={42} color="#fdcb6e" style={{ marginBottom: 10 }} />
            <Text style={[styles.modalTitle, { color: themeColors.text, textAlign: 'center', fontSize: 16 }]}>
              Synthesis Job In Progress
            </Text>
            <Text style={{ fontSize: 13, color: themeColors.textMuted, textAlign: 'center', marginBottom: 20, lineHeight: 18 }}>
              {activeRunningJob?.job_id === selectedJobId ? 'This job' : `Another job (${activeRunningJob?.filename})`} is currently rendering. How would you like to handle this request?
            </Text>

            <View style={{ gap: 10, width: '100%' }}>
              <TouchableOpacity
                style={{ padding: 12, borderRadius: 8, backgroundColor: '#ff7675', alignItems: 'center' }}
                onPress={async () => {
                  if (activeRunningJob?.job_id) {
                    await midiOrchestratorApi.cancelJob(activeRunningJob.job_id).catch(() => {});
                  }
                  setShowConflictModal(false);
                  await executeProcessTask();
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>Cancel Running Job & Start New</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ padding: 12, borderRadius: 8, backgroundColor: themeColors.accent, alignItems: 'center' }}
                onPress={async () => {
                  setShowConflictModal(false);
                  await executeProcessTask();
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>Queue New Job</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ padding: 12, borderRadius: 8, backgroundColor: themeColors.border, alignItems: 'center' }}
                onPress={() => setShowConflictModal(false)}
              >
                <Text style={{ color: themeColors.text, fontWeight: 'bold', fontSize: 13 }}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Playlist Select Modal */}
      <Modal visible={playlistModal.visible} transparent animationType="slide" onRequestClose={() => setPlaylistModal(p => ({ ...p, visible: false }))}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: themeColors.surface, width: '88%', padding: 20, borderRadius: 16 }]}>
            <Text style={[styles.modalTitle, { color: themeColors.text, fontSize: 18, marginBottom: 15 }]}>Add to Playlist</Text>
            
            <TextInput 
              style={[styles.modalInput, { marginBottom: 10, borderColor: themeColors.border, backgroundColor: themeColors.background, color: themeColors.text }]} 
              placeholder="New Playlist Name" 
              placeholderTextColor={themeColors.textMuted} 
              value={playlistModal.newPlaylistName} 
              onChangeText={(v) => setPlaylistModal(p => ({ ...p, newPlaylistName: v }))} 
            />
            <TouchableOpacity 
              style={[styles.modalBtn, { backgroundColor: themeColors.accent, marginBottom: 20, padding: 12, borderRadius: 8, alignItems: 'center', opacity: playlistModal.newPlaylistName.trim() ? 1.0 : 0.6 }]} 
              onPress={handleCreateAndAddPlaylist} 
              disabled={!playlistModal.newPlaylistName.trim()}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>Create & Add</Text>
            </TouchableOpacity>

            <ScrollView style={{ maxHeight: 220, marginBottom: 10 }}>
              {Object.keys(playlists || {}).length === 0 ? (
                <Text style={{ color: themeColors.textMuted, textAlign: 'center', padding: 15 }}>No existing playlists found.</Text>
              ) : (
                Object.keys(playlists).map(name => (
                  <TouchableOpacity 
                    key={name} 
                    style={{ paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: themeColors.border, flexDirection: 'row', alignItems: 'center' }} 
                    onPress={() => handleAddToPlaylist(name)}
                  >
                    <View style={{ backgroundColor: getPlaylistColor(name), marginRight: 10, width: 8, height: 16, borderRadius: 3 }} />
                    <Text style={{ fontSize: 16, fontWeight: '600', color: themeColors.text }}>{name}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <TouchableOpacity 
              style={{ padding: 12, borderRadius: 8, backgroundColor: themeColors.surfaceSecondary, marginTop: 10, alignItems: 'center' }} 
              onPress={() => setPlaylistModal(p => ({ ...p, visible: false }))}
            >
              <Text style={{ color: themeColors.text, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  jobInfo: {
    flex: 1,
  },
  jobFilename: {
    fontSize: 14,
    fontWeight: '500',
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
    width: 170,
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
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
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
  statusTag: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  statusTagText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
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
  },
  searchBar: { 
    padding: 10, 
    borderRadius: 8, 
    fontSize: 16, 
    marginBottom: 10 
  },
  sortBar: { 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  sortBtn: { 
    paddingHorizontal: 10, 
    paddingVertical: 5, 
    borderRadius: 15, 
    marginRight: 5 
  },
  sortBtnText: { 
    fontSize: 12 
  }
});
