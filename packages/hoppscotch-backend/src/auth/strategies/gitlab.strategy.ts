import { Strategy } from 'passport-gitlab2';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { UserService } from 'src/user/user.service';
import { ConfigService } from '@nestjs/config';
import * as O from 'fp-ts/Option';
import * as E from 'fp-ts/Either';

@Injectable()
export class GitlabStrategy extends PassportStrategy(Strategy) {
  constructor(
    private authService: AuthService,
    private usersService: UserService,
    private configService: ConfigService,
  ) {
    super({
        clientID: configService.get('INFRA.GITLAB_CLIENT_ID'),
        clientSecret: configService.get('INFRA.GITLAB_CLIENT_SECRET'),
        callbackURL: configService.get('INFRA.GITLAB_CALLBACK_URL'),
        scope: [configService.get('INFRA.GITLAB_SCOPE')],
        baseURL: configService.get('INFRA.GITLAB_SITE'),
        store: true,
    });
  }

  async validate(accessToken, refreshToken, profile, done) {
    const user = await this.usersService.findUserByEmail(
      profile.emails[0].value,
    );
    if (O.isNone(user)) {
      const createdUser = await this.usersService.createUserSSO(
        accessToken,
        refreshToken,
        {
          ...profile,
          photos: [
            {
              value: profile.avatarUrl,
            },
          ],
        },
      );
      return createdUser;
    }

    /**
     * * displayName and photoURL maybe null if user logged-in via magic-link before SSO
     */
    if (!user.value.displayName || !user.value.photoURL) {
      const updatedUser = await this.usersService.updateUserDetails(
        user.value,
        profile,
      );
      if (E.isLeft(updatedUser)) {
        throw new UnauthorizedException(updatedUser.left);
      }
    }

    /**
     * * Check to see if entry for Github is present in the Account table for user
     * * If user was created with another provider findUserByEmail may return true
     */
    const providerAccountExists =
      await this.authService.checkIfProviderAccountExists(user.value, profile);

    if (O.isNone(providerAccountExists))
      await this.usersService.createProviderAccount(
        user.value,
        accessToken,
        refreshToken,
        profile,
      );

    return user.value;
  }
}
