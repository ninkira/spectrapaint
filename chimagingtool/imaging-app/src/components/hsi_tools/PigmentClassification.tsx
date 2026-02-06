// imaging-app/src/components/hsi_tools/PigmentClassification.tsx
import React, { useState } from 'react'

interface PigmentClassificationModalProps {
  isOpen: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
}

const PigmentClassificationModal: React.FC<PigmentClassificationModalProps> = ({
  isOpen,
  title,
  onClose,
  children,
}) => {
  const [value, setValue] = useState('')

  if (!isOpen) return null

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    alert('A name was submitted: ' + value)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        style={{
          background: 'white',
          minWidth: '320px',
          maxWidth: '900px',
          width: '90vw',
          maxHeight: '80vh',
          borderRadius: '8px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
          padding: '1.25rem 1.5rem',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', flex: 1 }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: '1.4rem',
              cursor: 'pointer',
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '1.25rem',
            alignItems: 'stretch',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 320px', minWidth: '260px' }}>{children}</div>
          <form
            onSubmit={handleSubmit}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              flex: '1 1 320px',
              minWidth: '260px',
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              Preprocessing Method
              <select defaultValue="coconut">
                <option value="grapefruit">Grapefruit</option>
                <option value="lime">Lime</option>
                <option value="coconut">Coconut</option>
                <option value="mango">Mango</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              Classification Method
              <select defaultValue="coconut">
                <option value="grapefruit">Grapefruit</option>
                <option value="lime">Lime</option>
                <option value="coconut">Coconut</option>
                <option value="mango">Mango</option>
              </select>
            </label>
            <input type="submit" value="Submit" />
          </form>
        </div>
      </div>
    </div>
  )
}

export default PigmentClassificationModal
