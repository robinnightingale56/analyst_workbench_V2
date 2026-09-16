import { describe, expect, it } from 'vitest';
import { restoreWorkspaceForm, sourceIsLive } from './starters';

describe('workspace starters', () => {
  it('restores saved prompt, classification, connectors, and selected evidence when resuming', () => {
    expect(restoreWorkspaceForm({
      prompt: 'Saved question',
      classification: 'CUI',
      sourceConnectorIds: ['demonstration-library'],
      assessment: { selectedSourceFileIds: ['source-1'] },
    } as never)).toEqual({
      prompt: 'Saved question',
      classification: 'CUI',
      selectedConnectors: ['demonstration-library'],
      selectedSources: ['source-1'],
    });
  });

  it('recognizes only actual public collection metadata as an ongoing-source lead', () => {
    expect(sourceIsLive({ tags: ['live'], collectionMethod: 'Google News public RSS' } as never)).toBe(true);
    expect(sourceIsLive({ tags: ['demonstration'], collectionMethod: 'Synthetic demonstration library' } as never)).toBe(false);
  });
});