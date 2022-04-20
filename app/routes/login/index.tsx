import { ActionFunction, Form, json, LoaderFunction } from "remix";
import InputPassword from "../../components/FormElements/InputPassword/InputPassword";
import InputText from "../../components/FormElements/InputText/InputText";
import HeaderLogo from "../../components/HeaderLogo/HeaderLogo";
import PageBackground from "../../components/PageBackground/PageBackground";
import {
  authenticator,
  sessionStorage,
  supabaseStrategy,
} from "../../auth.server";

export const Routes = {
  SuccessRedirect: "/",
  FailureRedirect: "/login",
};

type LoaderData = {
  error: Error | null;
};

export const loader: LoaderFunction = async (args) => {
  const { request } = args;

  await supabaseStrategy.checkSession(request, {
    successRedirect: "/",
  });

  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );

  const error = session.get(authenticator.sessionErrorKey);

  return json<LoaderData>({ error });
};

export const action: ActionFunction = async (args) => {
  const { request } = args;

  await authenticator.authenticate("sb", request, {
    successRedirect: Routes.SuccessRedirect,
    failureRedirect: Routes.FailureRedirect,
  });
};

export default function Index() {
  return (
    <Form method="post">
      <PageBackground imagePath="/images/default_kitchen.jpg" />
      <div className="md:container md:mx-auto relative z-10">
        <div className="flex flex-row -mx-4 justify-end">
          <div className="basis-6/12 px-4 pt-4 pb-24 flex flex-row items-center">
            <div className="">
              <HeaderLogo />
            </div>
            <div className="ml-auto">
              Noch kein Mitglied?{" "}
              <a href="/register" className="text-primary font-bold">
                Registrieren
              </a>
            </div>
          </div>
        </div>
        <div className="flex flex-row -mx-4">
          <div className="basis-6/12 px-4"> </div>
          <div className="basis-5/12 px-4">
            <h1 className="mb-8">Anmelden</h1>

            <div className="mb-4">
              <InputText id="email" label="E-Mail" />
            </div>

            <div className="mb-10">
              <InputPassword id="password" label="Passwort" />
            </div>

            <div className="flex flex-row -mx-4 mb-8 items-center">
              <div className="basis-6/12 px-4">
                <button type="submit" className="btn btn-primary">
                  Login
                </button>
              </div>
              <div className="basis-6/12 px-4 text-right">
                <a href="/reset" className="text-primary font-bold">
                  Passwort vergessen?
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Form>
  );
}