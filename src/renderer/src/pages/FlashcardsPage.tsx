import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClampKLabel,
  ALL_CLAMPK_LABELS,
  type Flashcard,
  type SubmitReviewInput,
  type ReviewRating
} from '@shared/types'
import ChessBoard from '../components/ChessBoard'
import ClampKBadge, { LABEL_DISPLAY, LABEL_STYLES } from '../components/ClampKBadge'
import {
  getLegalDests,
  fenTurnColor,
  fenIsCheck,
  tryMove,
  sanToSquares,
  applyMove,
  formatMainLine
} from '../lib/chess-utils'
import type { Config } from 'chessground/config'

type Step = 'classify' | 'play_move' | 'cloze' | 'reveal'

export default function FlashcardsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [cards, setCards] = useState<Flashcard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cardIndex, setCardIndex] = useState(0)
  const [step, setStep] = useState<Step>('classify')
  const [submitting, setSubmitting] = useState(false)
  const [startTime] = useState(Date.now())
  const [hintLevel, setHintLevel] = useState(0)

  // Step 1 state
  const [selectedLabels, setSelectedLabels] = useState<ClampKLabel[]>([])

  // Step 2 state
  const [moveAttempted, setMoveAttempted] = useState<string | null>(null)
  const [moveCorrect, setMoveCorrect] = useState<boolean | null>(null)
  const [boardFen, setBoardFen] = useState<string | null>(null)

  // Step 3 state
  const [clozeAnswer, setClozeAnswer] = useState('')

  const loadCards = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const due = await window.api.flashcards.getDue(20)
      setCards(due)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cards.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCards()
  }, [loadCards])

  const currentCard = cards[cardIndex] ?? null

  const resetStep = useCallback(() => {
    setStep('classify')
    setSelectedLabels([])
    setMoveAttempted(null)
    setMoveCorrect(null)
    setBoardFen(null)
    setHintLevel(0)
    setClozeAnswer('')
  }, [])

  const toggleLabel = (label: ClampKLabel) => {
    setSelectedLabels((prev) => {
      if (prev.includes(label)) return prev.filter((l) => l !== label)
      if (prev.length >= 3) return prev
      return [...prev, label]
    })
  }

  const labelsCorrect = useMemo(() => {
    if (!currentCard?.labels) return null
    const expected = [currentCard.labels.primary, ...currentCard.labels.secondary]
    return (
      selectedLabels.length > 0 && selectedLabels.every((l) => expected.includes(l))
    )
  }, [selectedLabels, currentCard])

  // Step 2: handle user move
  const handleUserMove = useCallback(
    (orig: string, dest: string) => {
      if (!currentCard) return
      const result = tryMove(currentCard.fen, orig, dest)
      if (!result) return
      const correct =
        result.san === currentCard.correctMove ||
        currentCard.acceptedMoves.includes(result.san)
      setMoveAttempted(result.san)
      setMoveCorrect(correct)
      setBoardFen(result.newFen)
      if (correct) {
        setTimeout(() => setStep('cloze'), 800)
      }
    },
    [currentCard]
  )

  const turnColor = currentCard ? fenTurnColor(currentCard.fen) : 'white'
  const orientation: 'white' | 'black' = currentCard?.userColor ?? turnColor

  const postBlunderFen = useMemo(() => {
    if (!currentCard) return null
    return applyMove(currentCard.fen, currentCard.playedMove)
  }, [currentCard])

  const lastMoveSquares = useMemo(() => {
    if (!currentCard) return undefined
    return sanToSquares(currentCard.fen, currentCard.playedMove)
  }, [currentCard])

  const boardConfig: Config = useMemo(() => {
    if (!currentCard) return { fen: 'start' }

    if (step === 'play_move') {
      const activeFen = boardFen ?? currentCard.fen
      if (moveAttempted) {
        return {
          fen: activeFen,
          orientation,
          viewOnly: false,
          movable: {
            free: false,
            color: turnColor,
            dests: new Map(),
            showDests: false
          },
          check: fenIsCheck(activeFen) ? fenTurnColor(activeFen) : false,
          highlight: { lastMove: true, check: true },
          animation: { enabled: true, duration: 200 }
        }
      }
      return {
        fen: currentCard.fen,
        orientation,
        turnColor,
        viewOnly: false,
        movable: {
          free: false,
          color: turnColor,
          dests: getLegalDests(currentCard.fen),
          showDests: true,
          events: { after: handleUserMove }
        },
        check: fenIsCheck(currentCard.fen) ? fenTurnColor(currentCard.fen) : false,
        highlight: { lastMove: true, check: true },
        animation: { enabled: true, duration: 200 }
      }
    }

    const showFen = postBlunderFen ?? currentCard.fen
    return {
      fen: showFen,
      orientation,
      lastMove: lastMoveSquares,
      viewOnly: true,
      check: fenIsCheck(showFen) ? fenTurnColor(showFen) : false,
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 200 }
    }
  }, [currentCard, step, boardFen, moveAttempted, orientation, turnColor, lastMoveSquares, handleUserMove, postBlunderFen])

  const handleGrade = async (rating: ReviewRating) => {
    if (!currentCard) return
    setSubmitting(true)
    try {
      const input: SubmitReviewInput = {
        cardId: currentCard.id,
        rating,
        moveAttempted: moveAttempted ?? undefined,
        moveCorrect: moveCorrect ?? undefined,
        labelsAnswer: selectedLabels.length > 0 ? selectedLabels : undefined,
        labelsCorrect: labelsCorrect ?? undefined,
        clozeAnswer: clozeAnswer || undefined,
        timeSpentMs: Date.now() - startTime
      }
      await window.api.flashcards.submitReview(input)
      if (cardIndex < cards.length - 1) {
        setCardIndex((i) => i + 1)
        resetStep()
      } else {
        setCards([])
        setCardIndex(0)
        resetStep()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review.')
    } finally {
      setSubmitting(false)
    }
  }

  // ---- Render ----

  if (loading) return <div className="p-10 text-sm text-zinc-500">Loading flashcards…</div>

  if (error) {
    return (
      <div className="p-10">
        <div className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
        <button
          onClick={loadCards}
          className="mt-4 rounded-md bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!currentCard) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-10 py-20 text-center">
        <p className="text-5xl">🎉</p>
        <h2 className="mt-4 text-xl font-semibold text-zinc-100">All caught up!</h2>
        <p className="mt-2 text-sm text-zinc-400">No flashcards due for review right now.</p>
        <button
          onClick={() => navigate('/games')}
          className="mt-6 rounded-md bg-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
        >
          Review your games
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center px-6 py-8">
      {/* Progress */}
      <div className="mb-6 flex items-center gap-3 text-xs text-zinc-500">
        <span>
          Card {cardIndex + 1} of {cards.length}
        </span>
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${((cardIndex + 1) / cards.length) * 100}%` }}
          />
        </div>
        <StepIndicator current={step} />
      </div>

      <div className="flex gap-8">
        {/* Board */}
        <div className="shrink-0">
          <ChessBoard config={boardConfig} className="h-[360px] w-[360px]" />
          <SourceGameContext key={currentCard.id} card={currentCard} />
        </div>

        {/* Step content */}
        <div className="w-80">
          {step === 'classify' && (
            <ClassifyStep
              selectedLabels={selectedLabels}
              onToggle={toggleLabel}
              onNext={() => setStep('play_move')}
            />
          )}
          {step === 'play_move' && (
            <PlayMoveStep
              card={currentCard}
              turnColor={turnColor}
              moveAttempted={moveAttempted}
              moveCorrect={moveCorrect}
              hintLevel={hintLevel}
              onHint={() => setHintLevel((h) => Math.min(h + 1, 3))}
              onContinue={() => setStep('cloze')}
            />
          )}
          {step === 'cloze' && (
            <ClozeStep
              prompt={currentCard.clozePrompt}
              answer={clozeAnswer}
              onChangeAnswer={setClozeAnswer}
              onNext={() => setStep('reveal')}
            />
          )}
          {step === 'reveal' && (
            <RevealStep
              card={currentCard}
              moveAttempted={moveAttempted}
              moveCorrect={moveCorrect}
              labelsCorrect={labelsCorrect}
              selectedLabels={selectedLabels}
              onGrade={handleGrade}
              submitting={submitting}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Sub-components ----

function StepIndicator({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'classify', label: 'Theme' },
    { key: 'play_move', label: 'Move' },
    { key: 'cloze', label: 'Cloze' },
    { key: 'reveal', label: 'Grade' }
  ]
  const idx = steps.findIndex((s) => s.key === current)
  return (
    <div className="flex gap-1">
      {steps.map((s, i) => (
        <span
          key={s.key}
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            i === idx
              ? 'bg-emerald-500/20 text-emerald-400'
              : i < idx
                ? 'bg-zinc-700 text-zinc-400'
                : 'bg-zinc-800/50 text-zinc-600'
          }`}
        >
          {s.label}
        </span>
      ))}
    </div>
  )
}

function ClassifyStep({
  selectedLabels,
  onToggle,
  onNext
}: {
  selectedLabels: ClampKLabel[]
  onToggle: (l: ClampKLabel) => void
  onNext: () => void
}) {
  return (
    <div>
      <h3 className="text-lg font-medium text-zinc-100">What type of mistake is this?</h3>
      <p className="mt-1 text-sm text-zinc-400">Select up to 3 CLAMP/K labels.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {ALL_CLAMPK_LABELS.map((label) => {
          const isSelected = selectedLabels.includes(label)
          return (
            <button
              key={label}
              onClick={() => onToggle(label)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                isSelected
                  ? LABEL_STYLES[label]
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
              }`}
            >
              {LABEL_DISPLAY[label]}
            </button>
          )
        })}
      </div>
      <button
        onClick={onNext}
        className="mt-6 w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
      >
        Next: Find the Best Move →
      </button>
    </div>
  )
}

const LABEL_HINTS: Record<ClampKLabel, string> = {
  [ClampKLabel.Checks]: 'Look for checks.',
  [ClampKLabel.LoosePieces]: "There's a loose piece.",
  [ClampKLabel.Alignments]: 'Look for pieces lined up on the same rank, file, or diagonal.',
  [ClampKLabel.Mobility]: 'Think about piece activity — something may be short of squares.',
  [ClampKLabel.PassedPawns]: 'Pay attention to the passed pawns.',
  [ClampKLabel.KingSafety]: 'Think about king safety.'
}

const GENERIC_HINT = 'Look for forcing moves — checks, captures, and threats.'

function sanPieceHint(san: string): string {
  if (san.startsWith('O-O')) return 'The best move is castling.'
  const pieceNames: Record<string, string> = {
    K: 'king',
    Q: 'queen',
    R: 'rook',
    B: 'bishop',
    N: 'knight'
  }
  const piece = pieceNames[san[0]] ?? 'pawn'
  return `The best move is a ${piece} move.`
}

function hintText(card: Flashcard, level: number): string {
  if (level >= 3) {
    return `The best move is ${card.correctMove}.`
  }
  if (level === 2) {
    return sanPieceHint(card.correctMove)
  }
  const label = card.topSuggestedLabel ?? card.labels?.primary
  return label ? LABEL_HINTS[label] : GENERIC_HINT
}

function PlayMoveStep({
  card,
  turnColor,
  moveAttempted,
  moveCorrect,
  hintLevel,
  onHint,
  onContinue
}: {
  card: Flashcard
  turnColor: 'white' | 'black'
  moveAttempted: string | null
  moveCorrect: boolean | null
  hintLevel: number
  onHint: () => void
  onContinue: () => void
}) {
  const sideHeader = card.userColor
    ? `You are ${card.userColor === 'white' ? 'White' : 'Black'} — find the best move`
    : `${turnColor === 'white' ? 'White' : 'Black'} to move — find the best move`

  if (!moveAttempted) {
    return (
      <div>
        <h3 className="text-lg font-medium text-zinc-100">{sideHeader}</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Play the correct move on the board.
        </p>
        <button
          onClick={onHint}
          disabled={hintLevel >= 3}
          className="mt-4 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-600 hover:text-zinc-200 transition-colors disabled:opacity-50"
        >
          {hintLevel === 0 ? 'Hint' : `Hint (${hintLevel}/3)`}
        </button>
        {hintLevel > 0 && (
          <div className="mt-3 space-y-1.5">
            {Array.from({ length: hintLevel }, (_, i) => (
              <p
                key={i}
                className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
              >
                {hintText(card, i + 1)}
              </p>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (moveCorrect) {
    return (
      <div>
        <h3 className="text-lg font-medium text-emerald-400">✓ Correct!</h3>
        <p className="mt-1 text-sm text-zinc-400">
          You played: <span className="font-mono text-zinc-200">{moveAttempted}</span>
        </p>
        <p className="mt-3 text-xs text-zinc-600">Moving to cloze step…</p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-lg font-medium text-zinc-100">✗ Not quite</h3>
      <div className="mt-3 space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
        <div>
          <span className="text-xs text-zinc-500">Your move: </span>
          <span className="font-mono text-red-400">{moveAttempted}</span>
        </div>
        <div>
          <span className="text-xs text-zinc-500">Best move: </span>
          <span className="font-mono text-emerald-400">{card.correctMove}</span>
        </div>
        {card.takeaway && (
          <div>
            <span className="text-xs text-zinc-500">Takeaway: </span>
            <p className="mt-0.5 text-zinc-300">{card.takeaway}</p>
          </div>
        )}
      </div>
      <button
        onClick={onContinue}
        className="mt-4 w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
      >
        Continue →
      </button>
    </div>
  )
}

function SourceGameContext({ card }: { card: Flashcard }) {
  const [expanded, setExpanded] = useState(false)

  const opponents =
    card.gameWhite || card.gameBlack
      ? `${card.gameWhite ?? '?'} vs ${card.gameBlack ?? '?'}`
      : null

  return (
    <div className="mt-3 w-[360px]">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-300 transition-colors"
      >
        <span>From game</span>
        <span className="text-zinc-600">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
          {opponents && <p className="text-zinc-300">{opponents}</p>}
          <p>
            Move {card.moveNumber}
            {card.timeControl ? ` · ${card.timeControl}` : ''}
          </p>
          {card.openingName && <p>{card.openingName}</p>}
        </div>
      )}
    </div>
  )
}

function ClozeStep({
  prompt,
  answer,
  onChangeAnswer,
  onNext
}: {
  prompt: string | null
  answer: string
  onChangeAnswer: (v: string) => void
  onNext: () => void
}) {
  return (
    <div>
      <h3 className="text-lg font-medium text-zinc-100">Fill in the blank</h3>
      {prompt ? (
        <p className="mt-2 text-sm text-zinc-300 leading-relaxed">{prompt}</p>
      ) : (
        <p className="mt-2 text-sm text-zinc-500 italic">No cloze prompt for this card.</p>
      )}
      <input
        type="text"
        value={answer}
        onChange={(e) => onChangeAnswer(e.target.value)}
        placeholder="Your answer…"
        className="mt-3 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
        onKeyDown={(e) => e.key === 'Enter' && onNext()}
      />
      <button
        onClick={onNext}
        className="mt-4 w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
      >
        Reveal Answer
      </button>
    </div>
  )
}

function RevealStep({
  card,
  moveAttempted,
  moveCorrect,
  labelsCorrect,
  selectedLabels,
  onGrade,
  submitting
}: {
  card: Flashcard
  moveAttempted: string | null
  moveCorrect: boolean | null
  labelsCorrect: boolean | null
  selectedLabels: ClampKLabel[]
  onGrade: (rating: ReviewRating) => void
  submitting: boolean
}) {
  const navigate = useNavigate()

  return (
    <div>
      <h3 className="text-lg font-medium text-zinc-100">Card Back</h3>

      <div className="mt-3 space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
        <Row label="Correct Move" value={card.correctMove} />
        {card.acceptedMoves.length > 0 && (
          <Row label="Also Accepted" value={card.acceptedMoves.join(', ')} />
        )}
        {moveAttempted && (
          <Row
            label="Your Move"
            value={`${moveAttempted} ${moveCorrect ? '✓' : '✗'}`}
          />
        )}
        {card.labels && (
          <div>
            <span className="text-xs text-zinc-500">Labels: </span>
            <div className="mt-0.5 flex flex-wrap gap-1">
              <ClampKBadge label={card.labels.primary} primary />
              {card.labels.secondary.map((l) => (
                <ClampKBadge key={l} label={l} />
              ))}
            </div>
          </div>
        )}
        {labelsCorrect !== null && (
          <Row
            label="Your Labels"
            value={`${selectedLabels.map((l) => LABEL_DISPLAY[l]).join(', ')} ${labelsCorrect ? '✓' : '✗'}`}
          />
        )}
        {card.clozeAnswer && <Row label="Cloze Answer" value={card.clozeAnswer} />}
        {card.takeaway && (
          <div>
            <span className="text-xs text-zinc-500">Takeaway: </span>
            <p className="mt-0.5 text-zinc-300">{card.takeaway}</p>
          </div>
        )}
        {card.engineLine.length > 0 && (
          <Row
            label="Engine line"
            value={formatMainLine(
              card.engineLine,
              card.moveNumber,
              fenTurnColor(card.fen)
            )}
          />
        )}
        <div className="pt-1">
          {card.gameId != null && (
            <button
              onClick={() => navigate(`/review/${card.gameId}`)}
              className="text-xs text-emerald-400 hover:text-emerald-300"
            >
              View in game →
            </button>
          )}
        </div>
      </div>

      <p className="mt-4 text-sm text-zinc-400">How did you do?</p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {(
          [
            { rating: 'again' as ReviewRating, label: 'Again', cls: 'bg-red-600/80 hover:bg-red-500' },
            { rating: 'hard' as ReviewRating, label: 'Hard', cls: 'bg-amber-600/80 hover:bg-amber-500' },
            { rating: 'good' as ReviewRating, label: 'Good', cls: 'bg-emerald-600/80 hover:bg-emerald-500' },
            { rating: 'easy' as ReviewRating, label: 'Easy', cls: 'bg-blue-600/80 hover:bg-blue-500' }
          ] as const
        ).map(({ rating, label, cls }) => (
          <button
            key={rating}
            onClick={() => onGrade(rating)}
            disabled={submitting}
            className={`rounded-md px-3 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${cls}`}
          >
            {label}
          </button>
        ))}
      </div>
      {card.intervalDays > 0 && (
        <p className="mt-2 text-xs text-zinc-600">
          Current interval: {card.intervalDays}d · Ease: {card.ease.toFixed(2)}
        </p>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-zinc-500">{label}: </span>
      <span className="font-mono text-zinc-300">{value}</span>
    </div>
  )
}
