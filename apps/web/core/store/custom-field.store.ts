/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { set, sortBy } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// services
import { CustomFieldService } from "@/services/custom-field.service";
// types
import type { ICustomField, ICustomFieldOption } from "@/types/custom-field";
// store
import type { CoreRootStore } from "./root.store";

export interface ICustomFieldStore {
  // loaders
  fetchedMap: Record<string, boolean>;
  // observables
  fieldMap: Record<string, ICustomField>;
  // computed
  projectCustomFields: ICustomField[] | undefined;
  // computed actions
  getProjectCustomFields: (projectId: string | undefined | null) => ICustomField[] | undefined;
  getCustomFieldById: (fieldId: string) => ICustomField | null;
  // fetch actions
  fetchCustomFields: (workspaceSlug: string, projectId: string) => Promise<ICustomField[]>;
  // field crud
  createCustomField: (workspaceSlug: string, projectId: string, data: Partial<ICustomField>) => Promise<ICustomField>;
  updateCustomField: (
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    data: Partial<ICustomField>
  ) => Promise<ICustomField>;
  deleteCustomField: (workspaceSlug: string, projectId: string, fieldId: string) => Promise<void>;
  // option crud
  createOption: (
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    data: Partial<ICustomFieldOption>
  ) => Promise<ICustomFieldOption>;
  updateOption: (
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    optionId: string,
    data: Partial<ICustomFieldOption>
  ) => Promise<ICustomFieldOption>;
  deleteOption: (workspaceSlug: string, projectId: string, fieldId: string, optionId: string) => Promise<void>;
  reorderOptions: (workspaceSlug: string, projectId: string, fieldId: string, optionIds: string[]) => Promise<void>;
}

export class CustomFieldStore implements ICustomFieldStore {
  // observables
  fieldMap: Record<string, ICustomField> = {};
  fetchedMap: Record<string, boolean> = {};
  // root + services
  rootStore;
  customFieldService;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      fieldMap: observable,
      fetchedMap: observable,
      projectCustomFields: computed,
      fetchCustomFields: action,
      createCustomField: action,
      updateCustomField: action,
      deleteCustomField: action,
      createOption: action,
      updateOption: action,
      deleteOption: action,
      reorderOptions: action,
    });
    this.rootStore = _rootStore;
    this.customFieldService = new CustomFieldService();
  }

  /** Custom fields of the current project, ordered by sequence. */
  get projectCustomFields() {
    const projectId = this.rootStore.router.projectId;
    if (!projectId || !this.fetchedMap[projectId]) return;
    return sortBy(
      Object.values(this.fieldMap).filter((field) => field?.project_id === projectId),
      "sequence"
    );
  }

  getProjectCustomFields = computedFn((projectId: string | undefined | null) => {
    if (!projectId || !this.fetchedMap[projectId]) return;
    return sortBy(
      Object.values(this.fieldMap).filter((field) => field?.project_id === projectId),
      "sequence"
    );
  });

  getCustomFieldById = computedFn((fieldId: string): ICustomField | null => this.fieldMap?.[fieldId] || null);

  fetchCustomFields = async (workspaceSlug: string, projectId: string) =>
    await this.customFieldService.getCustomFields(workspaceSlug, projectId).then((response) => {
      runInAction(() => {
        response.forEach((field) => set(this.fieldMap, [field.id], field));
        set(this.fetchedMap, projectId, true);
      });
      return response;
    });

  createCustomField = async (workspaceSlug: string, projectId: string, data: Partial<ICustomField>) =>
    await this.customFieldService.createCustomField(workspaceSlug, projectId, data).then((response) => {
      runInAction(() => set(this.fieldMap, [response.id], response));
      return response;
    });

  updateCustomField = async (
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    data: Partial<ICustomField>
  ) => {
    const original = this.fieldMap[fieldId];
    try {
      runInAction(() => set(this.fieldMap, [fieldId], { ...original, ...data }));
      const response = await this.customFieldService.updateCustomField(workspaceSlug, projectId, fieldId, data);
      // server is the source of truth (sequence/options can be normalized server-side)
      runInAction(() => set(this.fieldMap, [fieldId], response));
      return response;
    } catch (error) {
      runInAction(() => set(this.fieldMap, [fieldId], original));
      throw error;
    }
  };

  deleteCustomField = async (workspaceSlug: string, projectId: string, fieldId: string) => {
    if (!this.fieldMap[fieldId]) return;
    await this.customFieldService.deleteCustomField(workspaceSlug, projectId, fieldId);
    runInAction(() => {
      delete this.fieldMap[fieldId];
    });
  };

  // ---- options live on field.options; mutate that array in place ----
  private setOptions = (fieldId: string, options: ICustomFieldOption[]) => {
    const field = this.fieldMap[fieldId];
    if (!field) return;
    runInAction(() => set(this.fieldMap, [fieldId, "options"], sortBy(options, "sequence")));
  };

  createOption = async (workspaceSlug: string, projectId: string, fieldId: string, data: Partial<ICustomFieldOption>) =>
    await this.customFieldService.createOption(workspaceSlug, projectId, fieldId, data).then((response) => {
      const field = this.fieldMap[fieldId];
      this.setOptions(fieldId, [...(field?.options ?? []), response]);
      return response;
    });

  updateOption = async (
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    optionId: string,
    data: Partial<ICustomFieldOption>
  ) =>
    await this.customFieldService.updateOption(workspaceSlug, projectId, fieldId, optionId, data).then((response) => {
      const field = this.fieldMap[fieldId];
      this.setOptions(
        fieldId,
        (field?.options ?? []).map((option) => (option.id === optionId ? response : option))
      );
      return response;
    });

  deleteOption = async (workspaceSlug: string, projectId: string, fieldId: string, optionId: string) => {
    await this.customFieldService.deleteOption(workspaceSlug, projectId, fieldId, optionId);
    const field = this.fieldMap[fieldId];
    this.setOptions(
      fieldId,
      (field?.options ?? []).filter((option) => option.id !== optionId)
    );
  };

  reorderOptions = async (workspaceSlug: string, projectId: string, fieldId: string, optionIds: string[]) => {
    const response = await this.customFieldService.reorderOptions(workspaceSlug, projectId, fieldId, optionIds);
    this.setOptions(fieldId, response);
  };
}
