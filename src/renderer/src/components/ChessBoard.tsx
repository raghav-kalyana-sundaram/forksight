import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Config } from 'chessground/config'
import { useEffect, useRef } from 'react'

interface Props {
  config: Config
  className?: string
}

export default function ChessBoard({ config, className }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)
  const configRef = useRef(config)
  configRef.current = config

  const viewOnly = config.viewOnly ?? false

  const drawableDefaults = {
    enabled: true,
    visible: true,
    eraseOnClick: true,
    defaultSnapToValidMove: true,
    brushes: {
      green: { key: 'g', color: '#15781B', opacity: 0.8, lineWidth: 10 },
      red: { key: 'r', color: '#882020', opacity: 0.8, lineWidth: 10 },
      blue: { key: 'b', color: '#003088', opacity: 0.8, lineWidth: 10 },
      yellow: { key: 'y', color: '#e68f00', opacity: 0.8, lineWidth: 10 }
    }
  }

  useEffect(() => {
    if (!ref.current) return
    const cfg = configRef.current
    api.current = Chessground(ref.current, {
      ...cfg,
      drawable: { ...drawableDefaults, ...cfg.drawable }
    })
    return () => {
      api.current?.destroy()
      api.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewOnly])

  useEffect(() => {
    api.current?.set({
      ...config,
      drawable: {
        enabled: true,
        visible: true,
        eraseOnClick: true,
        defaultSnapToValidMove: true,
        ...config.drawable
      }
    })
  })

  return <div ref={ref} className={className ?? 'h-[400px] w-[400px]'} />
}
