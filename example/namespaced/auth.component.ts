import { Component } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

@Component({ selector: 'app-auth', template: '' })
export class AuthComponent {
  constructor(private translate: TranslateService) {}

  getLoginTitle(): string {
    return this.translate.instant('auth.login.title');
  }

  getError(type: 'invalidCredentials' | 'accountLocked'): string {
    return this.translate.instant(`auth.errors.${type}`);
  }

  showForgot(): string {
    // Esta key falta en fr
    return this.translate.instant('auth.login.forgotPassword');
  }

  // Key que no existe → diagnostic error
  broken(): string {
    return this.translate.instant('auth.nonexistent.key');
  }
}
