import type { DataFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useParams } from "@remix-run/react";
import { useState } from "react";
import { Form as RemixForm } from "remix-forms";
import { createAuthClient, getSessionUserOrThrow } from "~/auth.server";
import InputText from "~/components/FormElements/InputText/InputText";
import TextAreaWithCounter from "~/components/FormElements/TextAreaWithCounter/TextAreaWithCounter";
import Modal from "~/components/Modal/Modal";
import { checkFeatureAbilitiesOrThrow } from "~/lib/utils/application";
import { invariantResponse } from "~/lib/utils/response";
import { getParamValueOrThrow } from "~/lib/utils/routes";
import { deriveEventMode } from "../../utils.server";
import { getEventBySlug } from "./documents.server";
import {
  deleteDocumentSchema,
  type action as deleteDocumentAction,
} from "./documents/delete-document";
import {
  editDocumentSchema,
  type action as editDocumentAction,
} from "./documents/edit-document";
import {
  uploadDocumentSchema,
  type action as uploadDocumentAction,
} from "./documents/upload-document";
import { publishSchema, type action as publishAction } from "./events/publish";

export const loader = async (args: DataFunctionArgs) => {
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

  return json(
    {
      event: event,
    },
    { headers: response.headers }
  );
};

function closeModal(id: string) {
  // TODO: can this type assertion be removed and proofen by code?
  const $modalToggle = document.getElementById(
    `modal-edit-document-${id}`
  ) as HTMLInputElement | null;
  if ($modalToggle) {
    $modalToggle.checked = false;
  }
}

function clearFileInput() {
  // TODO: can this type assertion be removed and proofen by code?
  const $fileInput = document.getElementById(
    "document-upload-input"
  ) as HTMLInputElement | null;
  if ($fileInput) {
    $fileInput.value = "";
  }
}

function Documents() {
  const loaderData = useLoaderData<typeof loader>();
  const { slug } = useParams();

  const uploadDocumentFetcher = useFetcher<typeof uploadDocumentAction>();
  const editDocumentFetcher = useFetcher<typeof editDocumentAction>();
  const deleteDocumentFetcher = useFetcher<typeof deleteDocumentAction>();
  const publishFetcher = useFetcher<typeof publishAction>();

  const [fileSelected, setFileSelected] = useState(false);
  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (e.target.files[0].size > 5_000_000) {
        alert("Die Datei ist zu groß. Maximal 5MB.");
        clearFileInput();
        setFileSelected(false);
      } else {
        setFileSelected(true);
      }
    }
  };

  return (
    <>
      <h1 className="mb-8">Dokumente verwalten</h1>
      {loaderData.event.documents.length > 0 ? (
        <div className="mb-8">
          <h3>Aktuelle Dokumente</h3>
          <ul>
            {loaderData.event.documents.map((item) => {
              return (
                <div
                  key={`document-${item.document.id}`}
                  className="w-full flex items-center flex-row border-b border-neutral-400 p-4"
                >
                  <div className="mr-2">
                    <p>{item.document.title || item.document.filename}</p>
                    <p>({Math.round(item.document.sizeInMB * 100) / 100} MB)</p>
                  </div>
                  <div className="ml-auto flex-1/2 sm:flex">
                    <Link
                      className="btn btn-outline-primary btn-small mt-2 mr-2 w-full sm:w-auto"
                      to={`/event/${loaderData.event.slug}/documents-download?document_id=${item.document.id}`}
                      reloadDocument
                    >
                      Herunterladen
                    </Link>
                    <label
                      htmlFor={`modal-edit-document-${item.document.id}`}
                      className="btn btn-outline-primary btn-small mt-2 mr-2 w-full sm:w-auto"
                    >
                      Editieren
                    </label>
                    <Modal id={`modal-edit-document-${item.document.id}`}>
                      <RemixForm
                        method="post"
                        fetcher={editDocumentFetcher}
                        action={`/event/${loaderData.event.slug}/settings/documents/edit-document`}
                        schema={editDocumentSchema}
                        onSubmit={(event) => {
                          closeModal(item.document.id);
                          // @ts-ignore
                          if (event.nativeEvent.submitter.name === "cancel") {
                            event.preventDefault();
                            event.currentTarget.reset();
                          }
                        }}
                      >
                        {({ Field, Errors, register }) => (
                          <>
                            <Field
                              name="documentId"
                              hidden
                              value={item.document.id}
                            />
                            <Field
                              name="extension"
                              hidden
                              value={item.document.extension}
                            />
                            <Field name="title">
                              {({ Errors }) => (
                                <>
                                  <InputText
                                    {...register("title")}
                                    id="title"
                                    label="Titel"
                                    defaultValue={
                                      item.document.title ||
                                      item.document.filename
                                    }
                                  />
                                  <Errors />
                                </>
                              )}
                            </Field>
                            <Field name="description">
                              {({ Errors }) => (
                                <>
                                  <TextAreaWithCounter
                                    {...register("description")}
                                    id="description"
                                    label="Beschreibung"
                                    defaultValue={
                                      item.document.description || ""
                                    }
                                    maxCharacters={100}
                                  />
                                  <Errors />
                                </>
                              )}
                            </Field>
                            <button
                              type="submit"
                              className="btn btn-outline-primary ml-auto btn-small mt-2"
                            >
                              Speichern
                            </button>
                            <button
                              type="submit"
                              name="cancel"
                              className="btn btn-outline-primary ml-auto btn-small mt-2"
                            >
                              Abbrechen
                            </button>
                            <Errors />
                          </>
                        )}
                      </RemixForm>
                    </Modal>
                    <RemixForm
                      method="post"
                      fetcher={deleteDocumentFetcher}
                      action={`/event/${loaderData.event.slug}/settings/documents/delete-document`}
                      schema={deleteDocumentSchema}
                    >
                      {({ Field, Errors }) => (
                        <>
                          <Field
                            name="documentId"
                            hidden
                            value={item.document.id}
                          />
                          <button
                            type="submit"
                            className="btn btn-outline-primary ml-auto btn-small mt-2 w-full sm:w-auto"
                          >
                            Löschen
                          </button>
                          <Errors />
                        </>
                      )}
                    </RemixForm>
                  </div>
                </div>
              );
            })}
          </ul>
          <Link
            className="btn btn-outline btn-primary mt-4"
            to={`/event/${loaderData.event.slug}/documents-download`}
            reloadDocument
          >
            Alle Herunterladen
          </Link>
        </div>
      ) : null}

      <RemixForm
        method="post"
        fetcher={uploadDocumentFetcher}
        action={`/event/${loaderData.event.slug}/settings/documents/upload-document`}
        schema={uploadDocumentSchema}
        encType="multipart/form-data"
        onTransition={() => {
          clearFileInput();
          setFileSelected(false);
        }}
      >
        {({ Field, Errors }) => (
          <>
            <Field name="uploadKey" hidden value={"document"} />
            <Field name="document" label="PDF Dokument auswählen">
              {({ Errors }) => (
                <>
                  <input
                    id="document-upload-input"
                    type="file"
                    accept="application/pdf"
                    onChange={onSelectFile}
                  />
                  <Errors />
                </>
              )}
            </Field>
            <button
              type="submit"
              className="btn btn-outline-primary ml-auto btn-small mt-2"
              disabled={!fileSelected}
            >
              PDF Dokument hochladen
            </button>
            <Errors />
          </>
        )}
      </RemixForm>
      <footer className="fixed bg-white border-t-2 border-primary w-full inset-x-0 bottom-0 pb-24 md:pb-0">
        <div className="container">
          <div className="flex flex-row flex-nowrap items-center justify-end my-4">
            <RemixForm
              schema={publishSchema}
              fetcher={publishFetcher}
              action={`/event/${slug}/settings/events/publish`}
              hiddenFields={["publish"]}
              values={{
                publish: !loaderData.event.published,
              }}
            >
              {(props) => {
                const { Button, Field } = props;
                return (
                  <>
                    <Field name="publish"></Field>
                    <Button className="btn btn-outline-primary">
                      {loaderData.event.published
                        ? "Verstecken"
                        : "Veröffentlichen"}
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

export default Documents;
