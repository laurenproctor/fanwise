"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { IMPORT_LIMITS } from "@/lib/imports/limits"

/**
 * Recording from the microphone, honestly.
 *
 * Permission is asked for only when the creator presses Record, and every
 * state the browser can put a recording in has a name here, so the composer
 * never shows "Recording" over a microphone that was refused or a browser that
 * cannot record at all. Capture is `MediaRecorder`; speech recognition in the
 * browser is not used, because what it hears is not what the server can check.
 *
 * The recording stops itself at the length the server accepts.
 */

export type RecorderState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording"; elapsedMs: number }
  | { kind: "paused"; elapsedMs: number }
  | { kind: "processing" }
  | { kind: "denied" }
  | { kind: "unsupported" }
  | { kind: "failed" }

export interface Recording {
  blob: Blob
  durationMs: number
  mimeType: string
}

const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
]

function pickType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined
  }
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
}

export function recordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  )
}

export function useRecorder(onRecorded: (recording: Recording) => void) {
  const [state, setState] = useState<RecorderState>({ kind: "idle" })
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const accumulated = useRef(0)
  const cancelled = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const onRecordedRef = useRef(onRecorded)
  useEffect(() => {
    onRecordedRef.current = onRecorded
  }, [onRecorded])

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    recorder.current = null
  }, [])

  useEffect(() => release, [release])

  const elapsed = () =>
    accumulated.current + (startedAt.current ? Date.now() - startedAt.current : 0)

  const stop = useCallback(() => {
    const active = recorder.current
    if (!active || active.state === "inactive") return
    cancelled.current = false
    setState({ kind: "processing" })
    active.stop()
  }, [])

  const cancel = useCallback(() => {
    const active = recorder.current
    cancelled.current = true
    if (active && active.state !== "inactive") active.stop()
    else release()
    setState({ kind: "idle" })
  }, [release])

  const start = useCallback(async () => {
    if (!recordingSupported()) {
      setState({ kind: "unsupported" })
      return
    }
    setState({ kind: "requesting" })
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ""
      setState(
        name === "NotAllowedError" || name === "SecurityError"
          ? { kind: "denied" }
          : name === "NotFoundError"
            ? { kind: "unsupported" }
            : { kind: "failed" },
      )
      return
    }

    const mimeType = pickType()
    let active: MediaRecorder
    try {
      // Speech needs little: 48 kbps keeps a ten-minute recording near 3.6 MB,
      // which one transcription request carries comfortably.
      active = new MediaRecorder(media, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 48_000,
      })
    } catch {
      media.getTracks().forEach((track) => track.stop())
      setState({ kind: "failed" })
      return
    }

    stream.current = media
    recorder.current = active
    chunks.current = []
    accumulated.current = 0
    startedAt.current = Date.now()
    cancelled.current = false

    active.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data)
    }
    active.onerror = () => {
      release()
      setState({ kind: "failed" })
    }
    active.onstop = () => {
      const durationMs = elapsed()
      const type = active.mimeType || mimeType || "audio/webm"
      const blob = new Blob(chunks.current, { type })
      release()
      startedAt.current = 0
      if (cancelled.current) return
      if (blob.size === 0) {
        setState({ kind: "failed" })
        return
      }
      setState({ kind: "idle" })
      onRecordedRef.current({ blob, durationMs, mimeType: type })
    }

    active.start(1000)
    setState({ kind: "recording", elapsedMs: 0 })
    timer.current = setInterval(() => {
      const now = elapsed()
      if (now >= IMPORT_LIMITS.maxAudioMs) {
        stop()
        return
      }
      setState((current) =>
        current.kind === "recording" ? { kind: "recording", elapsedMs: now } : current,
      )
    }, 250)
  }, [release, stop])

  const pause = useCallback(() => {
    const active = recorder.current
    if (!active || active.state !== "recording" || typeof active.pause !== "function") return
    active.pause()
    accumulated.current = elapsed()
    startedAt.current = 0
    setState({ kind: "paused", elapsedMs: accumulated.current })
  }, [])

  const resume = useCallback(() => {
    const active = recorder.current
    if (!active || active.state !== "paused") return
    active.resume()
    startedAt.current = Date.now()
    setState({ kind: "recording", elapsedMs: accumulated.current })
  }, [])

  const reset = useCallback(() => setState({ kind: "idle" }), [])

  return { state, start, stop, cancel, pause, resume, reset }
}
