import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  useFetcher,
  useLoaderData,
  useParams,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import { GravityType } from "imgproxy/dist/types";
import { Form, Form as RemixForm } from "remix-forms";
import { createAuthClient, getSessionUserOrThrow } from "~/auth.server";
import Autocomplete from "~/components/Autocomplete/Autocomplete";
import { H3 } from "~/components/Heading/Heading";
import { getImageURL } from "~/images.server";
import { getInitialsOfName } from "~/lib/string/getInitialsOfName";
import { checkFeatureAbilitiesOrThrow } from "~/lib/utils/application";
import { invariantResponse } from "~/lib/utils/response";
import { getParamValueOrThrow } from "~/lib/utils/routes";
import { getOrganizationSuggestionsForAutocomplete } from "~/routes/utils.server";
import { getPublicURL } from "~/storage.server";
import { deriveEventMode } from "../../utils.server";
import { publishSchema, type action as publishAction } from "./events/publish";
import {
  getEventBySlug,
  getOwnOrganizationsSuggestions,
  getResponsibleOrganizationDataFromEvent,
} from "./organizations.server";
import {
  addOrganizationSchema,
  type action as addOrganizationAction,
} from "./organizations/add-organization";
import {
  removeOrganizationSchema,
  type action as removeOrganizationAction,
} from "./organizations/remove-organization";

export const loader = async (args: LoaderArgs) => {
  const { request, params } = args;
  const response = new Response();
  const authClient = createAuthClient(request, response);
  await checkFeatureAbilitiesOrThrow(authClient, "events");
  const slug = getParamValueOrThrow(params, "slug");
  const sessionUser = await getSessionUserOrThrow(authClient);
  const event = await getEventBySlug(slug);
  invariantResponse(event, "Event not found", { status: 404 });
  const mode = await deriveEventMode(sessionUser, slug);
  invariantResponse(mode === "admin", "Not privileged", { status: 403 });

  const organizations = getResponsibleOrganizationDataFromEvent(event);

  const enhancedOrganizations = organizations.map((organization) => {
    if (organization.logo !== null) {
      const publicURL = getPublicURL(authClient, organization.logo);
      if (publicURL !== null) {
        organization.logo = getImageURL(publicURL, {
          resize: { type: "fill", width: 64, height: 64 },
          gravity: GravityType.center,
        });
      }
    }
    return organization;
  });

  const alreadyResponsibleOrganizationSlugs = organizations.map(
    (organization) => {
      return organization.slug;
    }
  );

  const ownOrganizationsSuggestions = await getOwnOrganizationsSuggestions(
    sessionUser.id,
    alreadyResponsibleOrganizationSlugs
  );

  const enhancedOwnOrganizations = ownOrganizationsSuggestions.map(
    (organization) => {
      if (organization.logo !== null) {
        const publicURL = getPublicURL(authClient, organization.logo);
        if (publicURL !== null) {
          organization.logo = getImageURL(publicURL, {
            resize: { type: "fill", width: 64, height: 64 },
            gravity: GravityType.center,
          });
        }
      }
      return organization;
    }
  );

  const url = new URL(request.url);
  const suggestionsQuery =
    url.searchParams.get("autocomplete_query") || undefined;
  let responsibleOrganizationSuggestions;
  if (suggestionsQuery !== undefined && suggestionsQuery !== "") {
    const query = suggestionsQuery.split(" ");

    responsibleOrganizationSuggestions =
      await getOrganizationSuggestionsForAutocomplete(
        authClient,
        alreadyResponsibleOrganizationSlugs,
        query
      );
  }

  return json(
    {
      published: event.published,
      responsibleOrganizations: enhancedOrganizations,
      responsibleOrganizationSuggestions,
      ownOrganizationsSuggestions: enhancedOwnOrganizations,
    },
    { headers: response.headers }
  );
};

function Organizations() {
  const { slug } = useParams();
  const loaderData = useLoaderData<typeof loader>();
  const addOrganizationFetcher = useFetcher<typeof addOrganizationAction>();
  const removeOrganizationFetcher =
    useFetcher<typeof removeOrganizationAction>();
  const publishFetcher = useFetcher<typeof publishAction>();
  const [searchParams] = useSearchParams();
  const suggestionsQuery = searchParams.get("autocomplete_query");
  const submit = useSubmit();

  return (
    <>
      <h1 className="mb-8">Verantwortliche Organisationen</h1>
      <p className="mb-8">
        Welche Organisation ist verantwortlich für Eure Veransatltung? Füge hier
        weitere Organisationen hinzu oder entferne sie.
      </p>
      <h4 className="mb-4 mt-4 font-semibold">Organisation hinzufügen</h4>
      <p className="mb-8">
        Füge hier Deiner Veranstaltung eine bereits bestehende Organisation
        hinzu.
      </p>
      <Form
        schema={addOrganizationSchema}
        fetcher={addOrganizationFetcher}
        action={`/event/${slug}/settings/organizations/add-organization`}
        onSubmit={() => {
          submit({
            method: "get",
            action: `/event/${slug}/settings/organizations`,
          });
        }}
      >
        {({ Field, Errors, Button, register }) => {
          return (
            <>
              <Errors />
              <div className="form-control w-full">
                <div className="flex flex-row items-center mb-2">
                  <div className="flex-auto">
                    <label id="label-for-name" htmlFor="Name" className="label">
                      Name der Organisation
                    </label>
                  </div>
                </div>

                <div className="flex flex-row">
                  <Field name="organizationId" className="flex-auto">
                    {({ Errors }) => (
                      <>
                        <Errors />
                        <Autocomplete
                          suggestions={
                            loaderData.responsibleOrganizationSuggestions || []
                          }
                          suggestionsLoaderPath={`/event/${slug}/settings/organizations`}
                          defaultValue={suggestionsQuery || ""}
                          {...register("organizationId")}
                          searchParameter="autocomplete_query"
                        />
                      </>
                    )}
                  </Field>
                  <div className="ml-2">
                    <Button className="bg-transparent w-10 h-8 flex items-center justify-center rounded-md border border-neutral-500 text-neutral-600 mt-0.5">
                      +
                    </Button>
                  </div>
                </div>
              </div>
            </>
          );
        }}
      </Form>
      {addOrganizationFetcher.data !== undefined &&
      "message" in addOrganizationFetcher.data ? (
        <div className={`p-4 bg-green-200 rounded-md mt-4`}>
          {addOrganizationFetcher.data.message}
        </div>
      ) : null}
      {loaderData.ownOrganizationsSuggestions.length > 0 ? (
        <>
          <h4 className="mb-4 mt-16 font-semibold">
            Eigene Organisationen hinzufügen
          </h4>
          <p className="mb-8">
            Hier werden dir Deine eigenen Organisationen vorgeschlagen um sie
            auf einen Klick als verantwortliche Organisationen hinzuzufügen.
          </p>
          <div className="mb-4 md:max-h-[630px] overflow-auto">
            <ul>
              {loaderData.ownOrganizationsSuggestions.map((organization) => {
                const initials = getInitialsOfName(organization.name);
                return (
                  <li
                    className="w-full flex items-center flex-row flex-nowrap border-b border-neutral-400 py-4 md:px-4"
                    key={organization.id}
                  >
                    <div className="h-16 w-16 bg-primary text-white text-3xl flex items-center justify-center rounded-full border overflow-hidden shrink-0">
                      {organization.logo !== null &&
                      organization.logo !== "" ? (
                        <img src={organization.logo} alt={organization.name} />
                      ) : (
                        <>{initials}</>
                      )}
                    </div>
                    <div className="pl-4">
                      <Link to={`/organization/${organization.slug}`}>
                        <H3
                          like="h4"
                          className="text-xl mb-1 no-underline hover:underline"
                        >
                          {organization.name}
                        </H3>
                      </Link>
                      {organization.types.length !== 0 ? (
                        <p className="font-bold text-sm cursor-default">
                          {organization.types
                            .map((relation) => {
                              return relation.organizationType.title;
                            })
                            .join(" / ")}
                        </p>
                      ) : null}
                    </div>
                    <Form
                      schema={addOrganizationSchema}
                      fetcher={addOrganizationFetcher}
                      action={`/event/${slug}/settings/organizations/add-organization`}
                      hiddenFields={["organizationId"]}
                      values={{
                        organizationId: organization.id,
                      }}
                      className="ml-auto"
                    >
                      {(props) => {
                        const { Field, Errors } = props;
                        return (
                          <>
                            <Errors />
                            <Field name="organizationId" />
                            <button
                              className="btn btn-outline-primary ml-auto btn-small"
                              title="Hinzufügen"
                              type="submit"
                            >
                              Hinzufügen
                            </button>
                          </>
                        );
                      }}
                    </Form>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : null}

      <h4 className="mb-4 mt-16 font-semibold">Organisationen</h4>
      <p className="mb-8">
        Hier siehst du alle für die Veranstaltung verantwortlichen
        Organisationen auf einen Blick.
      </p>
      <div className="mb-4 md:max-h-[630px] overflow-auto">
        <ul>
          {loaderData.responsibleOrganizations.map((organization) => {
            const initials = getInitialsOfName(organization.name);
            return (
              <li
                className="w-full flex items-center flex-row flex-nowrap border-b border-neutral-400 py-4 md:px-4"
                key={organization.id}
              >
                <div className="h-16 w-16 bg-primary text-white text-3xl flex items-center justify-center rounded-full border overflow-hidden shrink-0">
                  {organization.logo !== null && organization.logo !== "" ? (
                    <img src={organization.logo} alt={organization.name} />
                  ) : (
                    <>{initials}</>
                  )}
                </div>
                <div className="pl-4">
                  <Link to={`/organization/${organization.slug}`}>
                    <H3
                      like="h4"
                      className="text-xl mb-1 no-underline hover:underline"
                    >
                      {organization.name}
                    </H3>
                  </Link>
                  {organization.types.length !== 0 ? (
                    <p className="font-bold text-sm cursor-default">
                      {organization.types
                        .map((relation) => {
                          return relation.organizationType.title;
                        })
                        .join(" / ")}
                    </p>
                  ) : null}
                </div>
                <Form
                  schema={removeOrganizationSchema}
                  fetcher={removeOrganizationFetcher}
                  action={`/event/${slug}/settings/organizations/remove-organization`}
                  hiddenFields={["organizationId"]}
                  values={{
                    organizationId: organization.id,
                  }}
                  className="ml-auto"
                >
                  {(props) => {
                    const { Field, Button, Errors } = props;
                    return (
                      <>
                        <Errors />
                        <Field name="organizationId" />
                        <Button className="ml-auto btn-none" title="entfernen">
                          <svg
                            viewBox="0 0 10 10"
                            width="10px"
                            height="10px"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M.808.808a.625.625 0 0 1 .885 0L5 4.116 8.308.808a.626.626 0 0 1 .885.885L5.883 5l3.31 3.308a.626.626 0 1 1-.885.885L5 5.883l-3.307 3.31a.626.626 0 1 1-.885-.885L4.116 5 .808 1.693a.625.625 0 0 1 0-.885Z"
                              fill="currentColor"
                            />
                          </svg>
                        </Button>
                      </>
                    );
                  }}
                </Form>
              </li>
            );
          })}
        </ul>
      </div>
      <footer className="fixed bg-white border-t-2 border-primary w-full inset-x-0 bottom-0 pb-24 md:pb-0">
        <div className="container">
          <div className="flex flex-row flex-nowrap items-center justify-end my-4">
            <RemixForm
              schema={publishSchema}
              fetcher={publishFetcher}
              action={`/event/${slug}/settings/events/publish`}
              hiddenFields={["publish"]}
              values={{
                publish: !loaderData.published,
              }}
            >
              {(props) => {
                const { Button, Field } = props;
                return (
                  <>
                    <Field name="publish"></Field>
                    <Button className="btn btn-outline-primary">
                      {loaderData.published ? "Verstecken" : "Veröffentlichen"}
                    </Button>
                  </>
                );
              }}
            </RemixForm>
          </div>
        </div>
      </footer>
    </>
  );
}

export default Organizations;
