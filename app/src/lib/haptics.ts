// Petit retour haptique.
// Android : navigator.vibrate. iPhone : Safari n'a pas vibrate ; depuis iOS 18, basculer un interrupteur
// natif (<input type="checkbox" switch>) produit un léger « tic » haptique, qu'on déclenche via un label invisible.
let iosSwitch: HTMLLabelElement | null = null

export function haptic(ms = 12) {
  try {
    if (typeof navigator.vibrate === 'function' && navigator.vibrate(ms)) return
    if (!/iphone|ipad|ipod/i.test(navigator.userAgent)) return
    if (!iosSwitch) {
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('switch', '')
      input.tabIndex = -1
      iosSwitch = document.createElement('label')
      iosSwitch.setAttribute('aria-hidden', 'true')
      iosSwitch.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;left:-10px;top:0'
      iosSwitch.appendChild(input)
      document.body.appendChild(iosSwitch)
    }
    iosSwitch.click()
  } catch { /* pas de retour haptique sur cet appareil */ }
}
