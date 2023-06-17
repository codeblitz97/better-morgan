const http = require("http");
const betterMorgan = require("../index");

describe("better-morgan", () => {
  let req, res, next;

  beforeEach(() => {
    req = new http.IncomingMessage();
    res = new http.ServerResponse(req);
    next = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("should skip request and not log", () => {
    const logger = betterMorgan("combined", {
      skip: (req, res) => req.url.includes("skip"),
    });

    req.url = "/skip";
    logger(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.finished).toBe(false); // Check if response is not finished
  });

  // Add more test cases as needed
});
