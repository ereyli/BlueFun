export function normalizeChatText(value: string) {
  return value.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 240);
}

export function chatMessageToSign(input: { chainId: number; launchId: string; token: string; text: string; timestamp: number }) {
  return [
    "BlueFun community message",
    `Chain: ${input.chainId}`,
    `Launch: ${input.launchId}`,
    `Token: ${input.token.toLowerCase()}`,
    `Timestamp: ${input.timestamp}`,
    `Message: ${normalizeChatText(input.text)}`
  ].join("\n");
}
