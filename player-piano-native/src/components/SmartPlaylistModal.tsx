import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Switch, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import { useStore } from '../store/useStore';

interface SmartPlaylistModalProps {
  visible: boolean;
  initialData?: {
    name: string;
    filterType?: 'artist' | 'genre' | 'mood' | 'source' | 'rating' | 'validated' | 'all';
    filterValue?: string;
    excludeDnu: boolean;
    filters?: Array<{ filter_type: string, filter_value: string }>;
  };
  onClose: () => void;
  onGenerate: (
    name: string, 
    type: string | null, 
    value: string | null, 
    excludeDnu: boolean,
    filters?: Array<{ filter_type: string, filter_value: string }>
  ) => Promise<void>;
  themeColors: any;
}

export const SmartPlaylistModal = React.memo(({ visible, initialData, onClose, onGenerate, themeColors }: SmartPlaylistModalProps) => {
  const uniqueMetadata = useStore(state => state.uniqueMetadata);
  const [name, setName] = useState('');
  const [filters, setFilters] = useState<Array<{ filter_type: string, filter_value: string }>>([
    { filter_type: 'artist', filter_value: '' }
  ]);
  const [excludeDnu, setExcludeDnu] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(initialData?.name || '');
      setExcludeDnu(initialData?.excludeDnu !== undefined ? initialData.excludeDnu : true);
      
      if (initialData?.filters && initialData.filters.length > 0) {
        setFilters(initialData.filters.map(f => ({ filter_type: f.filter_type, filter_value: f.filter_value })));
      } else if (initialData?.filterType) {
        setFilters([{ filter_type: initialData.filterType, filter_value: initialData.filterValue || '' }]);
      } else {
        setFilters([{ filter_type: 'artist', filter_value: '' }]);
      }
    }
  }, [visible, initialData]);

  const handleAddFilter = () => {
    setFilters([...filters, { filter_type: 'artist', filter_value: '' }]);
  };

  const handleRemoveFilter = (index: number) => {
    setFilters(filters.filter((_, idx) => idx !== index));
  };

  const handleUpdateFilterType = (index: number, type: string) => {
    setFilters(filters.map((f, idx) => {
      if (idx === index) {
        return { 
          filter_type: type, 
          filter_value: type === 'all' ? '*' : type === 'validated' ? 'true' : '' 
        };
      }
      return f;
    }));
  };

  const handleUpdateFilterValue = (index: number, value: string) => {
    setFilters(filters.map((f, idx) => {
      if (idx === index) {
        return { ...f, filter_value: value };
      }
      return f;
    }));
  };

  const handleGenerate = async () => {
    if (!name.trim()) {
      Alert.alert('Validation Error', 'Please enter a playlist name.');
      return;
    }
    const validFilters = filters.filter(f => f.filter_type === 'all' || f.filter_value.trim().length > 0);
    if (validFilters.length === 0) {
      Alert.alert('Validation Error', 'Please specify a value for at least one filter condition.');
      return;
    }
    
    setLoading(true);
    try {
      await onGenerate(
        name.trim(), 
        null, 
        null, 
        excludeDnu, 
        validFilters.map(f => ({ filter_type: f.filter_type, filter_value: f.filter_value.trim() }))
      );
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: themeColors.surface }]}>
          <Text style={[styles.modalTitle, { color: themeColors.text }]}>Smart Playlist Builder</Text>
          
          <Text style={[styles.label, { color: themeColors.textMuted, marginBottom: 8 }]}>Playlist Name</Text>
          <TextInput
            style={[styles.modalInput, { borderColor: themeColors.border, backgroundColor: themeColors.background, color: themeColors.text, marginBottom: 15 }]}
            value={name}
            onChangeText={setName}
            placeholder="e.g. My Favorites"
            placeholderTextColor={themeColors.textMuted}
          />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={[styles.label, { color: themeColors.textMuted }]}>Filter Conditions (AND)</Text>
          </View>

          <ScrollView style={{ maxHeight: 280, marginBottom: 10 }} nestedScrollEnabled={true}>
            {filters.map((filter, index) => (
              <View 
                key={index} 
                style={[
                  styles.filterContainer, 
                  { 
                    borderColor: themeColors.border, 
                    borderBottomWidth: index < filters.length - 1 ? 1 : 0, 
                    paddingBottom: index < filters.length - 1 ? 15 : 0, 
                    marginBottom: index < filters.length - 1 ? 15 : 0 
                  }
                ]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={[styles.label, { color: themeColors.accent, fontSize: 11 }]}>Condition #{index + 1}</Text>
                  {filters.length > 1 && (
                    <TouchableOpacity onPress={() => handleRemoveFilter(index)}>
                      <Ionicons name="close-circle-outline" size={20} color="#ff5252" />
                    </TouchableOpacity>
                  )}
                </View>
                
                {/* Filter Type Selector Chips */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {['artist', 'genre', 'mood', 'source', 'rating', 'validated', 'all'].map((type) => (
                    <TouchableOpacity 
                      key={type} 
                      onPress={() => handleUpdateFilterType(index, type)}
                      style={[
                        styles.filterChip, 
                        { backgroundColor: filter.filter_type === type ? themeColors.accent : themeColors.surfaceSecondary }
                      ]}
                    >
                      <Text style={{ color: filter.filter_type === type ? '#fff' : themeColors.text, fontSize: 10, fontWeight: '600' }}>
                        {type.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {filter.filter_type !== 'all' && (
                  <>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text style={[styles.label, { color: themeColors.textMuted, fontSize: 10 }]}>
                        {filter.filter_type === 'rating' 
                          ? 'Rating (0=unrated, 1-5, or e.g. 4,5)' 
                          : filter.filter_type === 'validated'
                          ? 'Validation Status'
                          : 'Containing Text'}
                      </Text>
                      {filter.filter_type !== 'rating' && filter.filter_type !== 'validated' && (
                        <Text style={{ fontSize: 9, color: themeColors.textMuted }}>Comma-separated (OR)</Text>
                      )}
                    </View>

                    {filter.filter_type === 'validated' ? (
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                        <TouchableOpacity
                          style={[
                            styles.filterChip,
                            { 
                              flex: 1, 
                              height: 40, 
                              justifyContent: 'center', 
                              alignItems: 'center',
                              backgroundColor: filter.filter_value.toLowerCase() === 'true' ? themeColors.accent : themeColors.surfaceSecondary,
                              borderColor: themeColors.border,
                              borderWidth: 1,
                              borderRadius: 8
                            }
                          ]}
                          onPress={() => handleUpdateFilterValue(index, 'true')}
                        >
                          <Text style={{ color: filter.filter_value.toLowerCase() === 'true' ? '#fff' : themeColors.text, fontWeight: '600', fontSize: 12 }}>
                            Validated (Hybrid Files)
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.filterChip,
                            { 
                              flex: 1, 
                              height: 40, 
                              justifyContent: 'center', 
                              alignItems: 'center',
                              backgroundColor: filter.filter_value.toLowerCase() === 'false' ? themeColors.accent : themeColors.surfaceSecondary,
                              borderColor: themeColors.border,
                              borderWidth: 1,
                              borderRadius: 8
                            }
                          ]}
                          onPress={() => handleUpdateFilterValue(index, 'false')}
                        >
                          <Text style={{ color: filter.filter_value.toLowerCase() === 'false' ? '#fff' : themeColors.text, fontWeight: '600', fontSize: 12 }}>
                            Not Validated (Normal Files)
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TextInput
                        style={[
                          styles.modalInput, 
                          { 
                            borderColor: themeColors.border, 
                            backgroundColor: themeColors.background, 
                            color: themeColors.text, 
                            marginBottom: 8, 
                            fontSize: 14, 
                            padding: 10,
                            textAlign: 'left'
                          }
                        ]}
                        value={filter.filter_value}
                        onChangeText={(val) => handleUpdateFilterValue(index, val)}
                        placeholder={filter.filter_type === 'rating' ? "e.g. 0 or 4,5" : "e.g. Final Fantasy, Chrono Trigger"}
                        placeholderTextColor={themeColors.textMuted}
                        keyboardType={filter.filter_type === 'rating' ? 'default' : 'default'}
                      />
                    )}

                    {filter.filter_type !== 'rating' && filter.filter_type !== 'validated' && uniqueMetadata[filter.filter_type] && uniqueMetadata[filter.filter_type].length > 0 && (
                      <ScrollView 
                        horizontal 
                        showsHorizontalScrollIndicator={false} 
                        contentContainerStyle={{ gap: 6, paddingBottom: 5 }}
                      >
                        {uniqueMetadata[filter.filter_type].map(suggestion => (
                          <TouchableOpacity 
                            key={suggestion}
                            style={[styles.suggestionChip, { backgroundColor: themeColors.surfaceSecondary }]}
                            onPress={() => {
                              const currentParts = filter.filter_value.split(',').map(s => s.trim()).filter(Boolean);
                              if (!currentParts.includes(suggestion)) {
                                currentParts.push(suggestion);
                                handleUpdateFilterValue(index, currentParts.join(', '));
                              }
                            }}
                          >
                            <Text style={{ color: themeColors.text, fontSize: 11 }}>{suggestion}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </>
                )}
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity 
            style={[styles.addFilterBtn, { borderColor: themeColors.border, borderWidth: 1, borderRadius: 8, padding: 10, alignItems: 'center', marginBottom: 15, flexDirection: 'row', justifyContent: 'center', gap: 6 }]}
            onPress={handleAddFilter}
          >
            <Ionicons name="add-circle-outline" size={18} color={themeColors.text} />
            <Text style={{ color: themeColors.text, fontWeight: '600', fontSize: 13 }}>Add Filter Condition (AND)</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
            <View>
              <Text style={{ color: themeColors.text, fontWeight: '600' }}>Exclude DNU</Text>
              <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Don't include songs marked 'Do Not Use'</Text>
            </View>
            <Switch 
              value={excludeDnu} 
              onValueChange={setExcludeDnu}
              trackColor={{ false: themeColors.border, true: '#ff5252' }}
            />
          </View>

          <View style={[styles.modalButtons, { marginTop: 10 }]}>
            <TouchableOpacity 
              style={[styles.modalBtn, { backgroundColor: themeColors.surfaceSecondary }]} 
              onPress={onClose}
              disabled={loading}
            >
              <Text style={{ color: themeColors.text }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.modalBtn, { backgroundColor: themeColors.accent }]} 
              onPress={handleGenerate}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{color: '#fff', fontWeight: '700'}}>Generate</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', borderRadius: 12, padding: 25 },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 15 },
  modalInput: { borderWidth: 1, borderRadius: 8, padding: 15, fontSize: 18, textAlign: 'center' },
  modalButtons: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, padding: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  filterChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  suggestionChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  filterContainer: { borderBottomColor: 'rgba(0,0,0,0.05)' },
  addFilterBtn: { borderStyle: 'dashed' }
});
