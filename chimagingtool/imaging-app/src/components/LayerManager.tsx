import { useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import type { Layer } from '../state/types'

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
  const { fileLayers, toggleLayer } = useApp()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const tree = useMemo(() => buildLayerTree(fileLayers), [fileLayers])

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
    return [
      <label key={node.id} className="lm-item" role="treeitem" style={indent}>
        <input
          type="checkbox"
          checked={layer.on}
          onChange={() => toggleLayer(layer.id)}
        />
        <span className="lm-name">{node.name}</span>
      </label>,
    ]
  }

  return (
    <aside className="layer-manager">
      <div className="lm-header">
        <span>Data Manager</span>
        <div className="lm-actions">
          <button title="New layer">＋</button>
          <button title="Group">🗃️</button>
          <button title="Delete">🗑️</button>
        </div>
      </div>

      <div className="lm-list" role="tree">
        {tree.flatMap((node) => renderNode(node))}
      </div>
    </aside>
  )
}
