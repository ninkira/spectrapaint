import { useMemo, useState, type JSX } from 'react'
import { FilePlus2, Trash2, X } from 'lucide-react'
import { useApp } from '../state/AppContext'
import type { Layer } from '../state/types'
import { deleteDataset } from '../lib/api'
import UploadDataModal from './Dataset/UploadDataModal'

type TreeNode = {
  id: string
  name: string
  kind: 'folder' | 'file'
  children?: TreeNode[]
  layer?: Layer
}

function buildLayerTree(layers: Layer[]): TreeNode[] {
  const root: TreeNode = { id: '__root__', name: '', kind: 'folder', children: [] }
  const folderIndex = new Map<string, TreeNode>()
  folderIndex.set('__root__', root)

  const sorted = [...layers].sort((a, b) => (a.path ?? '').localeCompare(b.path ?? ''))
  for (const layer of sorted) {
    const segments = (layer.path ?? layer.name).split('/').filter(Boolean)
    let currentPath = ''
    let parentId = '__root__'
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i]
      const isFile = i === segments.length - 1
      if (isFile) {
        folderIndex.get(parentId)?.children?.push({
          id: layer.id,
          name: segment,
          kind: 'file',
          layer,
        })
        continue
      }
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      if (!folderIndex.has(currentPath)) {
        const folderNode: TreeNode = {
          id: currentPath,
          name: segment,
          kind: 'folder',
          children: [],
        }
        folderIndex.set(currentPath, folderNode)
        folderIndex.get(parentId)?.children?.push(folderNode)
      }
      parentId = currentPath
    }
  }
  return root.children ?? []
}

export default function DataManager() {
  const { fileLayers, toggleLayer, datasetId, setDatasetId, refreshDatasets,
          projects, projectId, setProjectId, addProject } = useApp()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [uploadOpen, setUploadOpen] = useState(false)
  // Checkboxes are only shown while "Remove data" is armed.
  const [removeMode, setRemoveMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const tree = useMemo(() => buildLayerTree(fileLayers), [fileLayers])

  const toggleRemoveMode = () => {
    setRemoveMode((prev) => !prev)
    setCheckedIds(new Set())
  }

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Delete the checked layers (files + DB rows), then refresh and tidy up selection.
  const deleteSelected = async () => {
    const ids = [...checkedIds]
    if (ids.length === 0) return
    const label = ids.length === 1 ? 'this dataset' : `these ${ids.length} datasets`
    if (!window.confirm(
      `Remove ${label}? This permanently deletes the file(s) and their database records.`,
    )) return

    setDeleting(true)
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteDataset(id)))
      const failed = results.filter((r) => r.status === 'rejected').length
      const remaining = await refreshDatasets()
      // If the layer being viewed was removed, fall back to the first remaining dataset.
      if (datasetId && ids.includes(datasetId) && remaining[0]) {
        setDatasetId(remaining[0].id)
      }
      setRemoveMode(false)
      setCheckedIds(new Set())
      if (failed > 0) {
        window.alert(`${failed} of ${ids.length} item(s) could not be removed. See the console for details.`)
      }
    } catch (err) {
      console.error('Failed to remove datasets', err)
      window.alert('Could not remove the selected data.')
    } finally {
      setDeleting(false)
    }
  }

  // The trash/X button: delete when items are checked, otherwise arm/disarm remove mode.
  const onRemoveButtonClick = () => {
    if (deleting) return
    if (removeMode && checkedIds.size > 0) void deleteSelected()
    else toggleRemoveMode()
  }

  const renderNode = (node: TreeNode, depth = 0): JSX.Element[] => {
    const indent = { paddingLeft: `${8 + depth * 14}px` }
    if (node.kind === 'folder') {
      const isOpen = expanded[node.id] ?? true
      const rows: JSX.Element[] = [
        <button
          key={node.id}
          type="button"
          className="lm-item"
          style={{ ...indent, width: '100%', justifyContent: 'flex-start' }}
          onClick={() => setExpanded((prev) => ({ ...prev, [node.id]: !isOpen }))}
        >
          <span className="lm-name">{isOpen ? '▾' : '▸'} {node.name}</span>
        </button>,
      ]
      if (isOpen) {
        for (const child of node.children ?? []) {
          rows.push(...renderNode(child, depth + 1))
        }
      }
      return rows
    }

    const layer = node.layer
    if (!layer) return []

    // Remove mode: show a checkbox so several layers can be picked for removal.
    if (removeMode) {
      return [
        <label key={node.id} className="lm-item" role="treeitem" style={indent}>
          <input
            type="checkbox"
            checked={checkedIds.has(layer.id)}
            onChange={() => toggleChecked(layer.id)}
          />
          <span className="lm-name">{node.name}</span>
        </label>,
      ]
    }

    // Normal mode: click to choose; the chosen layer is highlighted by colour (no checkbox).
    return [
      <button
        key={node.id}
        type="button"
        role="treeitem"
        aria-selected={layer.on}
        className={`lm-item lm-file${layer.on ? ' lm-file--active' : ''}`}
        style={{ ...indent, width: '100%', justifyContent: 'flex-start' }}
        onClick={() => toggleLayer(layer.id)}
      >
        <span className="lm-name">{node.name}</span>
      </button>,
    ]
  }

  return (
    <aside className="layer-manager">
      <div className="lm-header">
        <span className="lm-header-title">Data Manager</span>
        <div className="lm-actions">
          <button
            type="button"
            className="lm-action"
            title="Add data"
            aria-label="Add data"
            onClick={() => setUploadOpen(true)}
          >
            <FilePlus2 size={18} />
          </button>
          <button
            type="button"
            className={`lm-action lm-action--danger${removeMode ? ' active' : ''}`}
            title={
              removeMode && checkedIds.size > 0
                ? `Remove ${checkedIds.size} selected`
                : removeMode
                  ? 'Cancel'
                  : 'Remove data'
            }
            aria-label={removeMode && checkedIds.size > 0 ? 'Remove selected data' : 'Remove data'}
            aria-pressed={removeMode}
            disabled={deleting}
            onClick={onRemoveButtonClick}
          >
            {removeMode && checkedIds.size > 0 ? <X size={18} /> : <Trash2 size={18} />}
          </button>
        </div>
      </div>

      {/* Which investigation is in view. Datasets, and anything uploaded, belong to it. */}
      <div className="lm-project" style={{ display: 'flex', gap: 4, padding: '0.25rem 0.5rem' }}>
        <select
          aria-label="Project"
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        >
          {projects.map((p) => (
            <option key={p.project_id} value={p.project_id}>{p.dc_title}</option>
          ))}
        </select>
        <button
          type="button"
          title="New project"
          aria-label="New project"
          onClick={() => {
            const title = window.prompt('Name for the new project')?.trim()
            if (title) void addProject(title).catch((err) => window.alert(String(err)))
          }}
        >
          +
        </button>
      </div>

      <div className="lm-list" role="tree">
        {tree.flatMap((node) => renderNode(node))}
      </div>

      <UploadDataModal isOpen={uploadOpen} onClose={() => setUploadOpen(false)} />
    </aside>
  )
}
