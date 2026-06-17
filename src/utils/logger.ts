import pc from "picocolors";

export const logger = {
  info(message: string) {
    console.log(message);
  },

  success(message: string) {
    console.log(pc.green(message));
  },

  warn(message: string) {
    console.log(pc.yellow(message));
  },

  error(message: string) {
    console.error(pc.red(message));
  },

  muted(message: string) {
    console.log(pc.gray(message));
  },

  heading(message: string) {
    console.log("");
    console.log(pc.bold(message));
  },
};
