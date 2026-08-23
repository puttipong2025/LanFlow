export function createPasswordResetAttemptId(createId = () => crypto.randomUUID()) {
  return createId();
}

export function nextPasswordResetAttemptId(
  currentId: string,
  valueChanged: boolean,
  createId = () => crypto.randomUUID(),
) {
  return valueChanged ? createId() : currentId;
}
