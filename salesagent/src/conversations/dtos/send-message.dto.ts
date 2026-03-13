import { IsUUID, IsString, MaxLength, IsNotEmpty } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  conversationId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content: string;
}
