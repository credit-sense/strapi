'use strict';

const { _, get } = require('lodash');
const { pick } = require('lodash/fp');
const { ApplicationError } = require('@strapi/utils').errors;
const { validateUserCreationInput } = require('../validation/user');
const {
  validateUserUpdateInput,
  validateUsersDeleteInput,
} = require('../../../server/validation/user');
const { getService } = require('../../../server/utils');

const pickUserCreationAttributes = pick(['firstname', 'lastname', 'email', 'roles']);

module.exports = {
  async create(ctx) {
    const { body } = ctx.request;
    const cleanData = { ...body, email: get(body, `email`, ``).toLowerCase() };

    await validateUserCreationInput(cleanData);

    const attributes = pickUserCreationAttributes(cleanData);
    const { useSSORegistration } = cleanData;

    const userAlreadyExists = await getService('user').exists({ email: attributes.email });

    if (userAlreadyExists) {
      throw new ApplicationError('Email already taken');
    }

    if (useSSORegistration) {
      Object.assign(attributes, { registrationToken: null, isActive: true });
    }

    const createdUser = await getService('user').create(attributes);
    const userInfo = getService('user').sanitizeUser(createdUser);

    // Note: We need to assign manually the registrationToken to the
    // final user payload so that it's not removed in the sanitation process.
    Object.assign(userInfo, { registrationToken: createdUser.registrationToken });

    ctx.created({ data: userInfo });
  },

  async update(ctx) {
    const { id } = ctx.params;
    const { body: input } = ctx.request;

    await validateUserUpdateInput(input);

    if (_.has(input, 'email')) {
      const uniqueEmailCheck = await getService('user').exists({
        id: { $ne: id },
        email: input.email,
      });

      if (uniqueEmailCheck) {
        throw new ApplicationError('A user with this email address already exists');
      }
    }

    const updatedUser = await getService('user').updateById(id, input);

    if (!updatedUser) {
      return ctx.notFound('User does not exist');
    }

    await getService('user').shouldUpdateEEDisabledUsersList(id, input);

    ctx.body = {
      data: getService('user').sanitizeUser(updatedUser),
    };
  },

  async deleteOne(ctx) {
    const { id } = ctx.params;

    const deletedUser = await getService('user').deleteById(id);

    if (!deletedUser) {
      return ctx.notFound('User not found');
    }

    await getService('user').shouldRemoveFromEEDisabledUsersList(id);

    return ctx.deleted({
      data: getService('user').sanitizeUser(deletedUser),
    });
  },

  /**
   * Delete several users
   * @param {KoaContext} ctx - koa context
   */
  async deleteMany(ctx) {
    const { body } = ctx.request;
    await validateUsersDeleteInput(body);

    const users = await getService('user').deleteByIds(body.ids);

    await getService('user').shouldRemoveFromEEDisabledUsersList(body.ids);

    const sanitizedUsers = users.map(getService('user').sanitizeUser);

    return ctx.deleted({
      data: sanitizedUsers,
    });
  },
};
