'use client'

import { RefObject, useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(useGSAP, ScrollTrigger)

function getReducedMotionPreference() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getReducedMotionPreference)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setPrefersReducedMotion(media.matches)

    sync()
    media.addEventListener('change', sync)

    return () => media.removeEventListener('change', sync)
  }, [])

  return prefersReducedMotion
}

type MotionRoot = HTMLElement | null

const MOTION_PLAYED_ATTR = 'data-motion-played'
const MOTION_QUEUED_ATTR = 'data-motion-queued'

function isVisibleOnLoad(element: HTMLElement) {
  if (typeof window === 'undefined') return false
  const rect = element.getBoundingClientRect()
  return rect.top <= window.innerHeight * 0.92
}

function hasPlayed(element: HTMLElement) {
  return element.getAttribute(MOTION_PLAYED_ATTR) === 'true'
}

function hasQueued(element: HTMLElement) {
  return element.getAttribute(MOTION_QUEUED_ATTR) === 'true'
}

function markPlayed(elements: HTMLElement[]) {
  elements.forEach((element) => element.setAttribute(MOTION_PLAYED_ATTR, 'true'))
}

function markQueued(elements: HTMLElement[]) {
  elements.forEach((element) => element.setAttribute(MOTION_QUEUED_ATTR, 'true'))
}

function clearQueued(elements: HTMLElement[]) {
  elements.forEach((element) => element.removeAttribute(MOTION_QUEUED_ATTR))
}

function finishMotion(elements: HTMLElement[]) {
  if (!elements.length) return

  gsap.set(elements, {
    autoAlpha: 1,
    x: 0,
    y: 0,
    scale: 1,
    clearProps: 'opacity,visibility,transform',
  })
}

function restoreVisibility(elements: HTMLElement[]) {
  if (!elements.length) return

  gsap.set(elements, {
    autoAlpha: 1,
    clearProps: 'opacity,visibility',
  })
}

function getMotionElements(root: MotionRoot) {
  if (!root) {
    return {
      heroCopy: [] as HTMLElement[],
      heroVisual: [] as HTMLElement[],
      staggerGroups: [] as HTMLElement[],
      revealItems: [] as HTMLElement[],
      parallaxItems: [] as HTMLElement[],
      hoverItems: [] as HTMLElement[],
    }
  }

  return {
    heroCopy: gsap.utils.toArray<HTMLElement>('[data-motion-hero-copy]', root),
    heroVisual: gsap.utils.toArray<HTMLElement>('[data-motion-hero-visual]', root),
    staggerGroups: gsap.utils.toArray<HTMLElement>('[data-motion-stagger]', root),
    revealItems: gsap.utils.toArray<HTMLElement>('[data-motion-reveal]', root),
    parallaxItems: gsap.utils.toArray<HTMLElement>('[data-motion-parallax]', root),
    hoverItems: gsap.utils.toArray<HTMLElement>('[data-motion-hover]', root),
  }
}

export function useUserPageMotion(rootRef: RefObject<MotionRoot>, dependencies: unknown[] = []) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const introPlayedRef = useRef(false)
  const initializedRef = useRef(false)

  useGSAP(
    () => {
      const root = rootRef.current
      if (!root || prefersReducedMotion) {
        return
      }

      const { parallaxItems, hoverItems } = getMotionElements(root)
      const hoverCleanups: Array<() => void> = []

      parallaxItems.forEach((item) => {
        gsap.to(item, {
          yPercent: -6,
          ease: 'none',
          scrollTrigger: {
            trigger: item,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 0.6,
          },
        })
      })

      hoverItems.forEach((item) => {
        const onEnter = () => {
          gsap.to(item, {
            y: -4,
            scale: 1.01,
            duration: 0.22,
            ease: 'power2.out',
            overwrite: 'auto',
          })
        }

        const onLeave = () => {
          gsap.to(item, {
            y: 0,
            scale: 1,
            duration: 0.22,
            ease: 'power2.out',
            overwrite: 'auto',
          })
        }

        item.addEventListener('pointerenter', onEnter)
        item.addEventListener('pointerleave', onLeave)

        hoverCleanups.push(() => {
          item.removeEventListener('pointerenter', onEnter)
          item.removeEventListener('pointerleave', onLeave)
        })
      })

      return () => {
        hoverCleanups.forEach((cleanup) => cleanup())
      }
    },
    { scope: rootRef, dependencies: [prefersReducedMotion], revertOnUpdate: true },
  )

  useGSAP(
    () => {
      const root = rootRef.current
      if (!root) return

      const isAuthSurface = root.closest('.brand-auth-shell') !== null
      const isInitialPass = !initializedRef.current
      const { heroCopy, heroVisual, staggerGroups, revealItems } = getMotionElements(root)
      const staggerItems = staggerGroups.flatMap((group) => gsap.utils.toArray<HTMLElement>('[data-motion-item]', group))
      const allTargets = [...new Set([...heroCopy, ...heroVisual, ...revealItems, ...staggerItems])]

      if (prefersReducedMotion) {
        finishMotion(allTargets)
        clearQueued(allTargets)
        markPlayed(allTargets)
        introPlayedRef.current = true
        initializedRef.current = true
        return
      }

      restoreVisibility(allTargets.filter(hasPlayed))

      const pendingHeroCopy = heroCopy.filter((item) => !hasPlayed(item) && !hasQueued(item))
      const pendingHeroVisual = heroVisual.filter((item) => !hasPlayed(item) && !hasQueued(item))
      const queuedHero = [...heroCopy, ...heroVisual].filter(hasQueued)

      if (!introPlayedRef.current && (pendingHeroCopy.length || pendingHeroVisual.length)) {
        const animatedHero = [...pendingHeroCopy, ...pendingHeroVisual]
        markQueued(animatedHero)

        const intro = gsap.timeline({
          defaults: { duration: 0.72, ease: 'power3.out' },
        })

        if (pendingHeroCopy.length) {
          intro.fromTo(
            pendingHeroCopy,
            {
              autoAlpha: 0,
              y: isAuthSurface ? 0 : 30,
            },
            {
              autoAlpha: 1,
              y: 0,
              stagger: 0.1,
              overwrite: 'auto',
            },
          )
        }

        if (pendingHeroVisual.length) {
          intro.fromTo(
            pendingHeroVisual,
            {
              autoAlpha: 0,
              x: isAuthSurface ? 0 : 28,
              y: isAuthSurface ? 0 : 18,
              scale: isAuthSurface ? 1 : 0.98,
            },
            {
              autoAlpha: 1,
              x: 0,
              y: 0,
              scale: 1,
              stagger: 0.08,
              overwrite: 'auto',
            },
            pendingHeroCopy.length ? 0.14 : 0,
          )
        }

        intro.eventCallback('onComplete', () => {
          finishMotion(animatedHero)
          clearQueued(animatedHero)
          markPlayed(animatedHero)
          introPlayedRef.current = true
        })
      } else if (!queuedHero.length && (heroCopy.length || heroVisual.length)) {
        restoreVisibility([...heroCopy, ...heroVisual])
        introPlayedRef.current = true
      }

      const refreshHandle = window.requestAnimationFrame(() => {
        ScrollTrigger.refresh()
      })

      staggerGroups.forEach((group) => {
        const items = gsap.utils.toArray<HTMLElement>('[data-motion-item]', group)
        const pendingItems = items.filter((item) => !hasPlayed(item) && !hasQueued(item))
        const queuedItems = items.filter(hasQueued)

        if (!pendingItems.length) {
          if (!queuedItems.length) {
            restoreVisibility(items)
          }
          return
        }

        markQueued(pendingItems)

        const fromConfig = {
          autoAlpha: 0,
          y: 24,
        }

        const toConfig = {
          autoAlpha: 1,
          y: 0,
          stagger: 0.08,
          duration: 0.62,
          ease: 'power3.out',
          overwrite: 'auto' as const,
        }

        const onComplete = () => {
          finishMotion(pendingItems)
          clearQueued(pendingItems)
          markPlayed(pendingItems)
        }

        if (!isInitialPass || isVisibleOnLoad(group)) {
          const tween = gsap.fromTo(pendingItems, fromConfig, toConfig)
          tween.eventCallback('onComplete', onComplete)
          return
        }

        const tween = gsap.fromTo(pendingItems, fromConfig, {
          ...toConfig,
          scrollTrigger: {
            trigger: group,
            start: 'top 86%',
            once: true,
            invalidateOnRefresh: true,
          },
        })
        tween.eventCallback('onComplete', onComplete)
      })

      revealItems.forEach((item) => {
        if (item.closest('[data-motion-stagger]')) return
        if (item.querySelector('[data-motion-hero-copy], [data-motion-hero-visual]')) return

        if (hasPlayed(item)) {
          restoreVisibility([item])
          return
        }

        if (hasQueued(item)) {
          return
        }

        markQueued([item])

        const fromConfig = {
          autoAlpha: 0,
          y: 26,
        }

        const toConfig = {
          autoAlpha: 1,
          y: 0,
          duration: 0.64,
          ease: 'power3.out',
          overwrite: 'auto' as const,
        }

        const onComplete = () => {
          finishMotion([item])
          clearQueued([item])
          markPlayed([item])
        }

        if (!isInitialPass || isVisibleOnLoad(item)) {
          const tween = gsap.fromTo(item, fromConfig, toConfig)
          tween.eventCallback('onComplete', onComplete)
          return
        }

        const tween = gsap.fromTo(item, fromConfig, {
          ...toConfig,
          scrollTrigger: {
            trigger: item,
            start: 'top 88%',
            once: true,
            invalidateOnRefresh: true,
          },
        })
        tween.eventCallback('onComplete', onComplete)
      })

      initializedRef.current = true

      return () => {
        window.cancelAnimationFrame(refreshHandle)
      }
    },
    { scope: rootRef, dependencies: [prefersReducedMotion, ...dependencies] },
  )
}
