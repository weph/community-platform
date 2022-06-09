import { render, screen, logRoles } from "@testing-library/react";
import ExternalServiceIcon from "./ExternalServiceIcon";

/** @type {jest.Expect} */
// @ts-ignore
const expect = global.expect;

const WEBSITE_PATH =
  "M.4 10a9.6 9.6 0 1 1 19.2 0A9.6 9.6 0 0 1 .4 10Zm9-8.308c-.804.245-1.602.984-2.264 2.226a9.164 9.164 0 0 0-.474 1.047 15.23 15.23 0 0 0 2.738.344V1.692ZM5.499 4.647c.17-.461.365-.893.577-1.294a8.04 8.04 0 0 1 .716-1.12 8.412 8.412 0 0 0-2.73 1.827c.433.22.915.419 1.437.588v-.001ZM4.61 9.4c.043-1.284.225-2.504.523-3.61a10.949 10.949 0 0 1-1.878-.8A8.357 8.357 0 0 0 1.622 9.4H4.61Zm1.68-3.29a14.813 14.813 0 0 0-.48 3.29H9.4V6.51a16.21 16.21 0 0 1-3.11-.4Zm4.309.398V9.4h3.588a14.813 14.813 0 0 0-.479-3.29c-.97.225-2.017.362-3.11.4v-.002ZM5.812 10.6c.042 1.184.211 2.297.479 3.29a16.338 16.338 0 0 1 3.109-.398V10.6H5.812Zm4.788 0v2.89a16.21 16.21 0 0 1 3.11.4c.267-.993.436-2.106.48-3.29H10.6Zm-3.938 4.435c.144.375.302.725.474 1.047.662 1.242 1.461 1.98 2.264 2.226v-3.616a15.23 15.23 0 0 0-2.739.344Zm.131 2.731a8.034 8.034 0 0 1-.717-1.12c-.221-.417-.414-.85-.577-1.294-.494.159-.975.355-1.438.588a8.411 8.411 0 0 0 2.731 1.826h.002Zm-1.66-3.556a16.031 16.031 0 0 1-.524-3.61H1.622a8.356 8.356 0 0 0 1.634 4.41 10.9 10.9 0 0 1 1.878-.8Zm8.074 3.556a8.41 8.41 0 0 0 2.73-1.825c-.462-.232-.943-.43-1.436-.588-.163.444-.356.876-.577 1.294a8.022 8.022 0 0 1-.716 1.12ZM10.6 14.691v3.617c.804-.245 1.602-.984 2.264-2.226.172-.322.331-.672.474-1.047-.9-.197-1.817-.312-2.738-.343v-.001Zm4.266-.481a10.9 10.9 0 0 1 1.878.8 8.355 8.355 0 0 0 1.634-4.41H15.39a16.027 16.027 0 0 1-.524 3.61Zm3.512-4.81a8.356 8.356 0 0 0-1.634-4.41 10.9 10.9 0 0 1-1.878.8 16.08 16.08 0 0 1 .524 3.61h2.988Zm-4.454-6.047c.212.401.407.833.578 1.294.493-.159.973-.355 1.435-.588a8.412 8.412 0 0 0-2.73-1.824c.262.34.502.716.717 1.118Zm-.586 1.612a9.308 9.308 0 0 0-.474-1.047c-.662-1.242-1.46-1.98-2.264-2.226v3.616a15.23 15.23 0 0 0 2.738-.344Z";

test("url and correct icon is displayed", () => {
  render(<ExternalServiceIcon service="website" url="http://test.tld" />);
  expect(screen.getByRole("link")).toHaveAttribute("href", "http://test.tld");
  expect(screen.getByTestId("path")).toHaveAttribute("d", WEBSITE_PATH);
});