import { toast } from 'sonner'

/**
 * Preset toast configurations for common scenarios.
 */
export const toastPresets = {
  success: (message: string) => toast.success(message, { duration: 3000 }),
  error: (message: string) => toast.error(message, { duration: 4000 }),
  orderPlaced: (market: string) => toast.success(`Order placed: ${market}`, { icon: '✅', duration: 3000 }),
  orderFailed: (reason: string) => toast.error(`Order failed: ${reason}`, { icon: '❌', duration: 5000 }),
  signalGenerated: (count: number) => toast.info(`${count} signals generated`, { icon: '⚡', duration: 2000 }),
  autonomyArmed: () => toast.success('Autonomy mode armed', { icon: '🚀', duration: 3000 }),
  killSwitchActivated: () => toast.error('Kill switch activated - all orders cancelled', { icon: '🛑', duration: 5000 })
}

export default toastPresets
