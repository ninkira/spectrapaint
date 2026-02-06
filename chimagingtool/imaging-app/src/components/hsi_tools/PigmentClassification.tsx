// components/PigmentClassification.tsx
import React from 'react'

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
  if (!isOpen) return null

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
          maxWidth: '600px',
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

        {/* ✅ Render modal content */}
        {children}
      </div>
    </div>
  )
}

export default PigmentClassificationModal
