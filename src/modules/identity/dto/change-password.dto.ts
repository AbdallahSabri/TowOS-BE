import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  // BE-SPEC §10: minimum 10 characters. The breach-list check happens in
  // PasswordService.assertNotBreached() - not expressible as a synchronous
  // class-validator decorator without wiring DI into class-validator itself.
  @IsString()
  @MinLength(10)
  newPassword!: string;
}
