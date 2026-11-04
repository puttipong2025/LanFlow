export const BONUS_LEAVE_EVENT = "lanflow:before-bonus-leave";
export function withBonusLeaveGuard(proceed: () => void) {
  const event = new CustomEvent(BONUS_LEAVE_EVENT, { cancelable: true, detail: { proceed } });
  if (window.dispatchEvent(event)) proceed();
}
