import { Home, Monitor } from 'lucide-react'

export default function ProjectNav() {
  return (
    <nav className="project-nav" aria-label="Project Navigation">
      <button className="nav-btn" title="Home" aria-label="Home">
        <Home size={22} />
      </button>
      <button className="nav-btn" title="Imaging tool" aria-label="Imaging tool">
        <Monitor size={22} />
      </button>
    </nav>
  )
}
