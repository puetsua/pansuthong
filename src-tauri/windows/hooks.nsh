; NSIS installer hooks for Pansutong (wired via bundle.windows.nsis.installerHooks
; in tauri.conf.json). These extend Tauri's stock NSIS template without replacing it.
;
; Problem this solves
; -------------------
; Tauri's NSIS template only unpins + deletes the Start Menu / Desktop shortcuts
; when the uninstaller runs OUTSIDE of update mode (installer.nsi: `${If} $UpdateMode
; <> 1`). The in-app updater passes `/UPDATE`, so updating through the app already
; preserves shortcuts and the taskbar pin. But when a user *manually* re-runs a newer
; setup.exe, the new installer runs the OLD uninstaller without `/UPDATE`, so it
; unpins the taskbar shortcut and deletes the .lnk — breaking the pin.
;
; A manual reinstall is still really an upgrade, so we want it to behave like one.
; The stock template invokes the old uninstaller in place with NSIS's `_?=<dir>`
; argument (installer.nsi appends `_?=$INSTDIR`), which suppresses the usual
; copy-to-%TEMP% relaunch. So `$EXEDIR == $INSTDIR` is true precisely when this
; uninstall is part of a reinstall/upgrade, and false for a genuine uninstall
; launched from Add/Remove Programs (which runs from a %TEMP% copy).
;
; In the reinstall case we force `$UpdateMode = 1` before the template's shortcut
; cleanup runs, so the existing shortcut and taskbar pin are left untouched. A real
; uninstall is unaffected and still cleans them up.
;
; Caveats (see also AGENTS.md):
;   * Installer hooks live in the *uninstaller*, so this only takes effect when
;     upgrading FROM a build that already ships this hook. The first release that
;     adds it cannot retroactively fix an upgrade from an older build.
;   * Windows forbids programmatic taskbar pinning, so a pin that was ALREADY
;     destroyed by a previous manual reinstall has to be re-pinned by hand once.
;   * Worst case if the in-place detection is ever wrong is a leftover shortcut
;     after a real uninstall — never a regression versus today's behaviour.

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $EXEDIR == $INSTDIR
    ; In-place uninstall => part of a reinstall/upgrade. Treat it like an update
    ; so the template keeps the shortcuts and taskbar pin intact.
    StrCpy $UpdateMode 1
  ${EndIf}
!macroend
